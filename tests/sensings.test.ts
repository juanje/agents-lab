import { describe, expect, it } from "vitest";
import { Sensings } from "../src/engine/sensings.ts";

describe("Sensings", () => {
  it("gives an agent's last sensing, not an earlier one or another agent's", () => {
    const sensings = new Sensings();
    sensings.record("a", { tool: "look", result: "first", atMs: 10 });
    sensings.record("a", { tool: "look", result: "second", atMs: 20 });
    sensings.record("b", { tool: "look", result: "b's", atMs: 30 });

    expect(sensings.last("a")).toEqual({ tool: "look", result: "second", atMs: 20 });
  });

  it("gives nothing for an agent that has sensed nothing", () => {
    const sensings = new Sensings();
    sensings.record("b", { tool: "look", result: "b's", atMs: 30 });

    expect(sensings.last("a")).toBeUndefined();
  });

  it("gives an agent's last sensing by a sensor, whatever it sensed after it", () => {
    const sensings = new Sensings();
    sensings.record("a", { tool: "look", result: "first", atMs: 10 });
    sensings.record("a", { tool: "look", result: "second", atMs: 20 });
    sensings.record("a", { tool: "read", result: "read", atMs: 30 });
    sensings.record("b", { tool: "look", result: "b's", atMs: 40 });

    expect(sensings.lastBy("a", "look")).toEqual({ tool: "look", result: "second", atMs: 20 });
    expect(sensings.lastBy("a", "examine")).toBeUndefined();
    expect(sensings.lastBy("c", "look")).toBeUndefined();
  });});
