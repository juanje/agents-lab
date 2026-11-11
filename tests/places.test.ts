import { describe, expect, it } from "vitest";
import { arrive, entitiesIn, exits, layout, leave, put, where } from "../src/engine/places.ts";
import { World } from "../src/engine/world.ts";

/** Three places: a passage of length 2 joins "hall" and "store", and one of length 5 "hall" and "yard". */
const building = () =>
  layout(
    ["hall", "store", "yard"],
    [
      { between: ["hall", "store"], length: 2 },
      { between: ["hall", "yard"], length: 5 },
    ],
  );

describe("where", () => {
  it("gives the place an entity was put in", () => {
    const space = put(put(building(), "a", "hall"), "b", "store");
    expect(where(space, "a")).toEqual({ place: "hall" });
    expect(where(space, "b")).toEqual({ place: "store" });
  });

  it("gives none for an entity the space does not hold", () => {
    expect(where(put(building(), "a", "hall"), "z")).toBeUndefined();
  });
});

describe("put", () => {
  it("refuses a place the space does not declare, naming it", () => {
    expect(() => put(building(), "a", "garden")).toThrow('place "garden"');
  });
});

describe("exits", () => {
  it("gives the places one passage away, each with the passage's length, whichever end of the passage the place is", () => {
    expect(exits(building(), "hall")).toEqual([
      { place: "store", length: 2 },
      { place: "yard", length: 5 },
    ]);
    expect(exits(building(), "store")).toEqual([{ place: "hall", length: 2 }]);
    expect(exits(building(), "yard")).toEqual([{ place: "hall", length: 5 }]);
  });
});

describe("entitiesIn", () => {
  it("gives every entity in a place, however many, in the order the space first held them, and none for a place that holds none", () => {
    const space = put(put(put(building(), "a", "hall"), "b", "store"), "c", "hall");
    expect(entitiesIn(space, "hall")).toEqual(["a", "c"]);
    expect(entitiesIn(space, "store")).toEqual(["b"]);
    expect(entitiesIn(space, "yard")).toEqual([]);
  });
});

describe("leave and arrive", () => {
  it("puts an entity that leaves a place in the passage towards the other place, in neither place, until it arrives there", () => {
    const world = new World(put(put(building(), "a", "hall"), "b", "store"));
    expect(world.apply(leave, { entity: "a", towards: "yard" })).toEqual({ applied: true });
    expect(where(world.state, "a")).toEqual({ passage: ["hall", "yard"], towards: "yard" });
    expect(entitiesIn(world.state, "hall")).toEqual([]);
    expect(entitiesIn(world.state, "yard")).toEqual([]);
    expect(world.apply(arrive, { entity: "a" })).toEqual({ applied: true });
    expect(where(world.state, "a")).toEqual({ place: "yard" });
    expect(where(world.state, "b")).toEqual({ place: "store" });
  });

  it("crosses a passage both ways, naming the passage as the layout declares it", () => {
    const world = new World(put(building(), "a", "store"));
    world.apply(leave, { entity: "a", towards: "hall" });
    expect(where(world.state, "a")).toEqual({ passage: ["hall", "store"], towards: "hall" });
    world.apply(arrive, { entity: "a" });
    expect(where(world.state, "a")).toEqual({ place: "hall" });
  });
});
