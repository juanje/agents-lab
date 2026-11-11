import { describe, expect, it } from "vitest";
import { ChangesSinceSensing } from "../src/engine/changes.ts";

describe("ChangesSinceSensing", () => {
  it("counts the effects other agents applied since an agent last sensed, not its own", () => {
    const changes = new ChangesSinceSensing();
    changes.applied("b");
    changes.sensed("a");

    changes.applied("b");
    changes.applied("a");
    changes.applied("c");

    expect(changes.since("a")).toBe(2);
  });

  it("counts from the agent's last sensing only", () => {
    const changes = new ChangesSinceSensing();
    changes.sensed("a");
    changes.applied("b");
    changes.sensed("a");

    expect(changes.since("a")).toBe(0);
  });

  it("gives nothing for an agent that has not sensed: there is no sensing to count from", () => {
    const changes = new ChangesSinceSensing();
    changes.applied("b");

    expect(changes.since("a")).toBeNull();
  });

  it("names the agent that applied each change since an agent last sensed, in the order applied", () => {
    const changes = new ChangesSinceSensing();
    changes.applied("b");
    changes.sensed("a");

    changes.applied("c");
    changes.applied("a");
    changes.applied("b");
    changes.applied("c");

    expect(changes.appliedBy("a")).toEqual(["c", "b", "c"]);
  });

  it("names no agents for an agent that has not sensed", () => {
    const changes = new ChangesSinceSensing();
    changes.applied("b");

    expect(changes.appliedBy("a")).toBeNull();
  });
});
