import { describe, expect, it } from "vitest";
import { arrive, entitiesIn, exits, inSight, layout, leave, put, where } from "../src/engine/places.ts";
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

describe("refusals", () => {
  /** "a" in "hall", "b" in "store", and "e" on its way from "yard" to "hall". */
  const world = () => new World(leave.effect(put(put(put(building(), "a", "hall"), "b", "store"), "e", "yard"), { entity: "e", towards: "hall" }));

  it.each([
    ["of an entity the space does not hold", { entity: "z", towards: "hall" }, 'entity "z"'],
    ["of an entity in a passage", { entity: "e", towards: "yard" }, 'entity "e"'],
    ["towards a place the space does not declare", { entity: "a", towards: "garden" }, 'place "garden"'],
    ["towards a place not one passage away", { entity: "b", towards: "yard" }, 'place "yard"'],
  ])("refuses a leave %s, naming it, and applies nothing", (_case, args, named) => {
    const space = world();
    const before = space.state;
    expect(() => space.apply(leave, args)).toThrow(named);
    expect(space.state).toBe(before);
    expect(space.version).toBe(0);
  });

  it.each([
    ["an entity the space does not hold", "z"],
    ["an entity in a place", "a"],
  ])("refuses an arrive of %s, naming it, and applies nothing", (_case, entity) => {
    const space = world();
    expect(() => space.apply(arrive, { entity })).toThrow(`entity "${entity}"`);
    expect(space.version).toBe(0);
  });

  it("refuses a layout whose passage names a place it does not declare, naming the place", () => {
    expect(() => layout(["hall", "store"], [{ between: ["hall", "garden"], length: 2 }])).toThrow('place "garden"');
    expect(() => layout(["hall", "store"], [{ between: ["garden", "hall"], length: 2 }])).toThrow('place "garden"');
  });

  it.each([0, -1])("refuses a layout with a passage of length %d, naming the length", (length) => {
    expect(() => layout(["hall", "store"], [{ between: ["hall", "store"], length }])).toThrow(`length ${length}`);
  });
});

describe("inSight", () => {
  /**
   * "a" and "c" in "hall", "b" in "store", "d" in "yard", "e" on its way from "yard" to "hall" and "f" from "hall" to
   * "yard".
   */
  const peopled = () => {
    let space = put(put(put(put(building(), "a", "hall"), "c", "hall"), "b", "store"), "d", "yard");
    space = leave.effect(put(space, "e", "yard"), { entity: "e", towards: "hall" });
    return leave.effect(put(space, "f", "hall"), { entity: "f", towards: "yard" });
  };

  it("from a place, gives the others in that place and in the passages that leave it", () => {
    expect(inSight(peopled(), "a").sort()).toEqual(["c", "e", "f"]);
  });

  it("from a passage, gives the others in that passage and in the two places it joins", () => {
    expect(inSight(peopled(), "e").sort()).toEqual(["a", "c", "d", "f"]);
  });

  it("gives no one through walls, nor in a place from another place", () => {
    expect(inSight(peopled(), "b")).toEqual([]);
    expect(inSight(peopled(), "d").sort()).toEqual(["e", "f"]);
  });

  it("refuses an entity the space does not hold, naming it", () => {
    expect(() => inSight(peopled(), "z")).toThrow('entity "z"');
  });
});
