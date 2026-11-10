import { describe, expect, it } from "vitest";
import { Sensings } from "../src/engine/sensings.ts";

describe("Sensings", () => {
  it("gives an agent's last sensing, not an earlier one or another agent's", () => {
    const sensings = new Sensings();
    sensings.record("a", { tool: "look", result: "first", atMs: 10 });
    sensings.record("a", { tool: "look", result: "second", atMs: 20 });
    sensings.record("b", { tool: "look", result: "b's", atMs: 30 });

    expect(sensings.last("a")).toEqual({ tool: "look", result: "second", atMs: 20 });
  });});
