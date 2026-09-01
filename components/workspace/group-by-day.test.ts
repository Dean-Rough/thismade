import { describe, expect, it } from "vitest";
import { groupByDay } from "./group-by-day";

const DAY = 24 * 60 * 60 * 1000;
// A fixed UTC noon anchor keeps this test's own local-timezone day
// boundaries stable regardless of where it runs.
const NOON_UTC = Date.UTC(2026, 0, 15, 12, 0, 0);

describe("groupByDay", () => {
  it("puts same-day items in one group, oldest group first", () => {
    const items = [NOON_UTC, NOON_UTC + 1000, NOON_UTC + 2000];
    const groups = groupByDay(items, (x) => x, NOON_UTC);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toEqual(items);
  });

  it("splits items on a day boundary into separate groups in chronological order", () => {
    const day1 = NOON_UTC;
    const day2 = NOON_UTC + DAY;
    const groups = groupByDay([day1, day2], (x) => x, day2);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toEqual([day1]);
    expect(groups[1].items).toEqual([day2]);
  });

  it("labels the current day 'Today' and the prior day 'Yesterday'", () => {
    const today = NOON_UTC;
    const yesterday = NOON_UTC - DAY;
    const groups = groupByDay([yesterday, today], (x) => x, today);
    expect(groups[0].label).toBe("Yesterday");
    expect(groups[1].label).toBe("Today");
  });

  it("returns no groups for an empty list", () => {
    expect(groupByDay([], (x: number) => x, NOON_UTC)).toEqual([]);
  });
});
