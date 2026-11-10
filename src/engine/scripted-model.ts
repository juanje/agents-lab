import { type FauxProviderHandle, type Model, type Models, createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { waitAtLeast } from "./clock.ts";

/** One answer of a script: its text, and how long the model takes to give it. */
export interface ScriptedAnswer {
  text: string;
  delayMs: number;
}

/**
 * A model for tests: Pi's faux provider giving an agent's scripted answers in order. Each scripted model has a faux
 * provider of its own, so one agent's script is never consumed by another agent's calls.
 */
export class ScriptedModel {
  /** Pi's models, holding only this model's faux provider; their credentials are kept in memory, never read from disk. */
  readonly models: Models;
  readonly model: Model<string>;
  readonly #faux: FauxProviderHandle;

  constructor(script: readonly ScriptedAnswer[]) {
    const faux = fauxProvider();
    // Each answer is a response factory, so its delay starts when the call reaches the provider, as a real model's does.
    faux.setResponses(
      script.map(({ text, delayMs }) => async () => {
        await waitAtLeast(delayMs);
        return fauxAssistantMessage(text);
      }),
    );
    const models = createModels();
    models.setProvider(faux.provider);
    this.models = models;
    this.model = faux.getModel();
    this.#faux = faux;
  }

  /** Whether every scripted answer has been given. */
  get exhausted(): boolean {
    return this.#faux.getPendingResponseCount() === 0;
  }
}
