import { type JsonObject, type Message, type Model, type Models, type Provider, createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { waitAtLeast } from "./clock.ts";

/** One answer of a script: its text, the tools it calls, and how long the model takes to give it. */
export interface ScriptedAnswer {
  text?: string;
  toolCalls?: readonly { name: string; arguments: JsonObject }[];
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

  constructor(script: readonly ScriptedAnswer[]) {
    const faux = fauxProvider();
    // Each answer is a response factory, so its delay starts when the call reaches the provider, as a real model's does.
    faux.setResponses(
      script.map(({ text, toolCalls = [], delayMs }) => async (context, options) => {
        this.sessions.push(options?.sessionId);
        // Copied: the caller may go on adding to the same transcript after this turn.
        this.received.push([...context.messages]);
        await waitAtLeast(delayMs);
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
