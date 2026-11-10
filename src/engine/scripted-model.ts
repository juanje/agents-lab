/** One answer of a script: its text, and how long the model takes to give it. */
export interface ScriptedAnswer {
  text: string;
  delayMs: number;
}

/** A model for tests: Pi's faux provider giving an agent's scripted answers in order. */
export class ScriptedModel {
  readonly script: readonly ScriptedAnswer[];

  constructor(script: readonly ScriptedAnswer[]) {
    this.script = script;
  }
}
