import { describe, expect, it } from "vitest";
import { labModel } from "../src/engine/adapter.ts";

describe("labModel", () => {
  it("gives the model a name in Pi's provider/id form names, which Pi's runtime serves with no provider of the run's", async () => {
    const { model, provider } = await labModel("openai/gpt-6-luna");

    expect({ provider: model.provider, id: model.id }).toEqual({ provider: "openai", id: "gpt-6-luna" });
    expect(provider).toBeUndefined();
  });

  it("refuses a name that is not in Pi's provider/id form, saying so", async () => {
    await expect(labModel("gpt-6-luna")).rejects.toThrow(`Model name "gpt-6-luna" is not in Pi's provider/id form`);
  });

  it("refuses a model the lab's Pi directory does not know, naming it", async () => {
    await expect(labModel("openai/no-such-model")).rejects.toThrow(`The lab's Pi directory knows no model "openai/no-such-model"`);
  });
});
