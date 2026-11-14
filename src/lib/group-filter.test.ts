import { describe, it, expect } from "vitest";
import { parseGroupFilterParams, describeGroupFilter, groupFilterParams } from "./group-filter";

const groups = [
  { id: "g-biz", name: "Business" },
  { id: "g-home", name: "Home" },
  { id: "g-food", name: "Food" },
];

describe("parseGroupFilterParams", () => {
  it("is inactive without a groups param", () => {
    expect(parseGroupFilterParams(undefined, undefined)).toEqual({});
    expect(parseGroupFilterParams("", "exclude")).toEqual({});
  });

  it("defaults to include mode", () => {
    expect(parseGroupFilterParams("g-biz,g-home", undefined)).toEqual({
      groupIds: ["g-biz", "g-home"],
      groupMode: "include",
    });
  });

  it("reads exclude mode, and treats anything else as include", () => {
    expect(parseGroupFilterParams("g-biz", "exclude").groupMode).toBe("exclude");
    expect(parseGroupFilterParams("g-biz", "bogus").groupMode).toBe("include");
  });

  it("drops empty and duplicate ids", () => {
    expect(parseGroupFilterParams("g-biz,,g-biz,", undefined).groupIds).toEqual(["g-biz"]);
  });
});

describe("groupFilterParams", () => {
  it("round-trips through the URL params, omitting the default mode", () => {
    expect(groupFilterParams(["g-biz"], "include")).toEqual({ groups: "g-biz", groupMode: null });
    expect(groupFilterParams(["g-biz", "g-home"], "exclude")).toEqual({
      groups: "g-biz,g-home",
      groupMode: "exclude",
    });
    expect(groupFilterParams([], "exclude")).toEqual({ groups: null, groupMode: null });
  });
});

describe("describeGroupFilter", () => {
  it("names one group, counts several, and says which mode", () => {
    expect(describeGroupFilter(["g-biz"], "include", groups)).toBe("Business");
    expect(describeGroupFilter(["g-biz", "g-home"], "include", groups)).toBe("2 groups");
    expect(describeGroupFilter(["g-biz"], "exclude", groups)).toBe("All except Business");
    expect(describeGroupFilter(["g-biz", "g-food"], "exclude", groups)).toBe("All except 2 groups");
  });

  it("is null when nothing selected resolves", () => {
    expect(describeGroupFilter([], "include", groups)).toBeNull();
    expect(describeGroupFilter(["gone"], "include", groups)).toBeNull();
  });
});
