// The "Launch week — day N of 7" widget (THI-14 Part 4.2). There is no
// dedicated onboarding-state model in the schema (agentTasks/agentEvents are
// Phase 3's scope, agentContextFiles/agentSkills are storage-only) — this is
// a v1 heuristic built entirely from data that already exists, flagged here
// (and in DECISIONS.md) rather than inventing new schema for it. Revisit if
// a later phase wants an explicit, owner-editable onboarding checklist.
export type LaunchPlanStep = {
  key: string;
  label: string;
  done: boolean;
};

export type LaunchPlanInput = {
  businessCreatedAt: number;
  now: number;
  contextFileKeys: ReadonlySet<string>;
  hasSkill: boolean;
  hasTask: boolean;
  hasCompletedTask: boolean;
};

export type LaunchPlanState = {
  dayNumber: number; // 1-7, clamped
  steps: LaunchPlanStep[];
  complete: boolean;
};

const IDENTITY_KEYS = ["SOUL", "OWNER", "BUSINESS"];
const OPERATIONS_KEYS = ["PLATFORM", "PLAYBOOK", "RUNBOOK"];
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function hasAny(keys: readonly string[], present: ReadonlySet<string>): boolean {
  return keys.some((key) => present.has(key));
}

export function computeLaunchPlan(input: LaunchPlanInput): LaunchPlanState {
  const elapsedDays = Math.floor((input.now - input.businessCreatedAt) / ONE_DAY_MS);
  const dayNumber = Math.min(7, Math.max(1, elapsedDays + 1));

  const steps: LaunchPlanStep[] = [
    { key: "business_created", label: "Business profile created", done: true },
    {
      key: "identity_configured",
      label: "Agent identity configured (SOUL/OWNER/BUSINESS)",
      done: hasAny(IDENTITY_KEYS, input.contextFileKeys),
    },
    {
      key: "operations_configured",
      label: "Operating playbook ready (PLATFORM/PLAYBOOK/RUNBOOK)",
      done: hasAny(OPERATIONS_KEYS, input.contextFileKeys),
    },
    { key: "skill_installed", label: "First skill installed", done: input.hasSkill },
    { key: "task_dispatched", label: "First task dispatched to a worker", done: input.hasTask },
    {
      key: "task_completed",
      label: "First task completed and reviewed",
      done: input.hasCompletedTask,
    },
    {
      key: "launch_week_complete",
      label: "Launch week complete",
      done: dayNumber >= 7,
    },
  ];

  return {
    dayNumber,
    steps,
    complete: steps.every((step) => step.done),
  };
}
