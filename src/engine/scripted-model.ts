import { type JsonObject, type Message, type Model, type Models, type Provider, createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { waitAtLeast } from "./clock.ts";

/**
 * The error message Pi's faux provider answers with once its script has run out (pi-ai 1.5.0, providers/faux.js), with
 * empty content, so the turn calls no tool and the activation ends there.
 */
export const SCRIPT_EXHAUSTED_MESSAGE = "No more faux responses queued";

/** How many scripted models have been made, so each gets a provider id of its own. */
let made = 0;

/**
 * One answer of a script: its text and the tools it calls, or the provider's error message in their place, and how
 * long the model takes to give it.
 */
export interface ScriptedAnswer {
  text?: string;
  toolCalls?: readonly { name: string; arguments: JsonObject }[];
  error?: string;
  delayMs: number;
}

/**
 * A model for tests: Pi's faux provider giving an agent's scripted answers in order. Each scripted model has a faux
 * provider of its own, so one agent's script is never consumed by another agent's calls.
 */
export class ScriptedModel {
  /** Pi's models, holding only this model's faux provider; their credentials are kept in memory, never read from disk. */
  readonly models: Models;
  /** The faux provider giving this model's answers, for a run to register with Pi's model runtime. */
  readonly provider: Provider;
  readonly model: Model<string>;
  /** The messages each turn received, in order, tool declarations included. */
  readonly received: Message[][] = [];
  /** The Pi session each turn came from, in order; undefined for a call made outside a session. */
  readonly sessions: (string | undefined)[] = [];

  /** Gives the script's answers as the model `id`, or as the faux provider's default model when no id is given. */
  constructor(script: readonly ScriptedAnswer[], id?: string) {
    // Pi's model runtime keeps one provider per id: a shared id would hand one agent's turns to another's script.
    made += 1;
    const faux = fauxProvider({ provider: `scripted-${made}`, ...(id === undefined ? {} : { models: [{ id }] }) });
    // Each answer is a response factory, so its delay starts when the call reaches the provider, as a real model's does.
    faux.setResponses(
      script.map(({ text, toolCalls = [], error, delayMs }) => async (context, options) => {
        this.sessions.push(options?.sessionId);
        // Copied: the caller may go on adding to the same transcript after this turn.
        this.received.push([...context.messages]);
        // An aborted call stops waiting, so a timed-out turn frees its model slot at once; Pi's faux provider then
        // answers it as aborted, whatever the script says.
        await waitAtLeast(delayMs, options?.signal);
        if (error !== undefined) return fauxAssistantMessage([], { stopReason: "error", errorMessage: error });
        return fauxAssistantMessage([
          ...(text === undefined ? [] : [fauxText(text)]),
          ...toolCalls.map((call) => fauxToolCall(call.name, call.arguments)),
        ]);
      }),
    );
    const models = createModels();
    models.setProvider(faux.provider);
    this.models = models;
    this.provider = faux.provider;
    this.model = faux.getModel();
  }
}
