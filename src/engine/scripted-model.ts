import { type FauxResponseFactory, type JsonObject, type Message, type Model, type Provider, fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { waitAtLeast } from "./clock.ts";
import { isSummaryRequest } from "./compaction.ts";

/**
 * The error message Pi's faux provider answers with once its script has run out (pi-ai 1.5.0, providers/faux.js), with
 * empty content, so the turn calls no tool and the activation ends there.
 */
export const SCRIPT_EXHAUSTED_MESSAGE = "No more faux responses queued";

/** How many scripted models have been made, so each gets a provider id of its own. */
let made = 0;

/**
 * One answer of a script: the reasoning the provider returns with it, its text and the tools it calls, or the provider's error message in their place, and how
 * long the model takes to give it.
 */
export interface ScriptedAnswer {
  reasoning?: string;
  text?: string;
  toolCalls?: readonly { name: string; arguments: JsonObject }[];
  error?: string;
  delayMs: number;
}

/** What a scripted model is besides its script. */
export interface ScriptedModelOptions {
  /** Whether it can reason, so Pi can give its sessions a thinking level other than "off". */
  reasoning?: boolean;
  /** Its context window, in tokens; the faux provider's own otherwise. */
  contextWindow?: number;
  /** The summary it writes whenever Pi asks it to write one for a compaction (FR-ADAPTER-03); none otherwise. */
  summary?: string;
  /** Whether each Pi session takes the script from its start, rather than all sessions sharing one. */
  perSession?: boolean;
}

/** How many answers the faux provider holds ready at once: more than the calls a run here makes at the same time. */
const READY = 64;

/**
 * A model for tests: Pi's faux provider giving an agent's scripted answers in order. Each scripted model has a faux
 * provider of its own, so one agent's script is never consumed by another agent's calls.
 */
export class ScriptedModel {
  /** The faux provider giving this model's answers, for a run to register with Pi's model runtime. */
  readonly provider: Provider;
  readonly model: Model<string>;
  /** The messages each turn received, in order, tool declarations included. */
  readonly received: Message[][] = [];
  /** The Pi session each turn came from, in order; undefined for a call made outside a session. */
  readonly sessions: (string | undefined)[] = [];
  /** The thinking level each turn asked for, in order; undefined for a call that asked for none. */
  readonly reasoningLevels: (string | undefined)[] = [];
  /** The messages each request to write a summary received, in order, kept apart from the turns. */
  readonly summaryRequests: Message[][] = [];

  /**
   * Gives the script's answers as the model `id`, or as the faux provider's default model when no id is given. Past
   * the script, it answers as Pi's faux provider does once its answers run out.
   */
  constructor(script: readonly ScriptedAnswer[], id?: string, { reasoning = false, contextWindow, summary, perSession = false }: ScriptedModelOptions = {}) {
    // Pi's model runtime keeps one provider per id: a shared id would hand one agent's turns to another's script.
    made += 1;
    const faux = fauxProvider({ provider: `scripted-${made}`, models: [{ id: id ?? "faux-1", reasoning, ...(contextWindow === undefined ? {} : { contextWindow }) }] });
    // The next answer of the script, for all sessions or for each, by its session.
    const next = new Map<string | undefined, number>();
    // Each answer is a response factory, so its delay starts when the call reaches the provider, as a real model's does.
    const answer: FauxResponseFactory = async (context, options) => {
      // Every call takes one answer from the provider: one more keeps as many ready.
      faux.appendResponses([answer]);
      if (summary !== undefined && isSummaryRequest(context.messages)) {
        this.summaryRequests.push([...context.messages]);
        return fauxAssistantMessage([fauxText(summary)]);
      }
      const key = perSession ? options?.sessionId : undefined;
      const at = next.get(key) ?? 0;
      const scripted = script[at];
      if (scripted === undefined) return fauxAssistantMessage([], { stopReason: "error", errorMessage: SCRIPT_EXHAUSTED_MESSAGE });
      next.set(key, at + 1);
      const { reasoning, text, toolCalls = [], error, delayMs } = scripted;
      this.sessions.push(options?.sessionId);
      this.reasoningLevels.push(options?.reasoning);
      // Copied: the caller may go on adding to the same transcript after this turn.
      this.received.push([...context.messages]);
      // An aborted call stops waiting, so a timed-out turn frees its model slot at once; Pi's faux provider then
      // answers it as aborted, whatever the script says.
      await waitAtLeast(delayMs, options?.signal);
      if (error !== undefined) return fauxAssistantMessage([], { stopReason: "error", errorMessage: error });
      return fauxAssistantMessage([
        ...(reasoning === undefined ? [] : [fauxThinking(reasoning)]),
        ...(text === undefined ? [] : [fauxText(text)]),
        ...toolCalls.map((call) => fauxToolCall(call.name, call.arguments)),
      ]);
    };
    faux.setResponses(Array.from({ length: READY }, () => answer));
    this.provider = faux.provider;
    this.model = faux.getModel();
  }
}
