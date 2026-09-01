import { describe, expect, it } from "vitest";
import { computeLaunchPlan } from "./launch-plan";

const DAY = 24 * 60 * 60 * 1000;

describe("computeLaunchPlan", () => {
  it("starts on day 1 with only the trivially-true step done", () => {
    const plan = computeLaunchPlan({
      businessCreatedAt: 1_000,
      now: 1_000,
      contextFileKeys: new Set(),
      hasSkill: false,
      hasTask: false,
      hasCompletedTask: false,
    });
    expect(plan.dayNumber).toBe(1);
    expect(plan.complete).toBe(false);
    expect(plan.steps.find((s) => s.key === "business_created")?.done).toBe(true);
    expect(plan.steps.filter((s) => s.done)).toHaveLength(1);
  });

  it("clamps day number at 7 even long after launch week", () => {
    const plan = computeLaunchPlan({
      businessCreatedAt: 0,
      now: 30 * DAY,
      contextFileKeys: new Set(),
      hasSkill: false,
      hasTask: false,
      hasCompletedTask: false,
    });
    expect(plan.dayNumber).toBe(7);
  });

  it("marks identity/operations steps done from any key in their group", () => {
    const plan = computeLaunchPlan({
      businessCreatedAt: 0,
      now: 0,
      contextFileKeys: new Set(["OWNER", "RUNBOOK"]),
      hasSkill: false,
      hasTask: false,
      hasCompletedTask: false,
    });
    expect(plan.steps.find((s) => s.key === "identity_configured")?.done).toBe(true);
    expect(plan.steps.find((s) => s.key === "operations_configured")?.done).toBe(true);
  });

  it("is complete only once every step is done, including launch week elapsed", () => {
    const plan = computeLaunchPlan({
      businessCreatedAt: 0,
      now: 7 * DAY,
      contextFileKeys: new Set(["SOUL", "OWNER", "BUSINESS", "PLATFORM", "PLAYBOOK", "RUNBOOK"]),
      hasSkill: true,
      hasTask: true,
      hasCompletedTask: true,
    });
    expect(plan.complete).toBe(true);
  });
});
