import { describe, expect, it } from "vitest";
import { layout, put, where } from "../src/engine/places.ts";

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
