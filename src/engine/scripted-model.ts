import { type Model, type Models, createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

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

  constructor(script: readonly ScriptedAnswer[]) {
    const faux = fauxProvider();
    faux.setResponses(script.map(({ text }) => fauxAssistantMessage(text)));
    const models = createModels();
    models.setProvider(faux.provider);
    this.models = models;
    this.model = faux.getModel();
  }
}
