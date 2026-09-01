import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { getDashboardConvexClient } from "./dashboardConvex";
import { getConvexServiceSecret } from "./serviceSecret";

export type WorkspaceFileCategory = "Identity" | "Operations" | "Evolving" | "Other";

export type WorkspaceFile = {
  key: string;
  title: string;
  category: WorkspaceFileCategory;
  content: string;
  updatedAt: number;
};

// Category mapping per docs/madethis-agent-architecture.md's captured
// manifest ("Identity: SOUL/BUSINESS/OWNER, Operations: PLAYBOOK/PLATFORM/
// RUNBOOK, Evolving: MEMORY/CODE_MAP") — the THI-14 plan (Part 4.14) names
// the four category buckets but not this mapping, so this is the source of
// truth for it. agentSkills (brandkit, etc.) aren't part of that 8-file
// manifest at all, so they land in "Other" rather than being forced into one
// of the four content categories.
const CONTEXT_FILE_CATEGORIES: Record<Doc<"agentContextFiles">["fileKey"], WorkspaceFileCategory> = {
  SOUL: "Identity",
  BUSINESS: "Identity",
  OWNER: "Identity",
  PLAYBOOK: "Operations",
  PLATFORM: "Operations",
  RUNBOOK: "Operations",
  MEMORY: "Evolving",
  CODE_MAP: "Evolving",
};

function titleCase(key: string): string {
  return key
    .toLowerCase()
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function fetchWorkspaceFiles(businessId: Id<"businesses">): Promise<WorkspaceFile[]> {
  const client = getDashboardConvexClient();
  const secret = getConvexServiceSecret();
  const [contextFiles, skills] = await Promise.all([
    client.action(api.agentContextFilesActions.listByBusiness, { businessId, secret }),
    client.action(api.agentSkillsActions.listByBusiness, { businessId, secret }),
  ]);

  const contextEntries: WorkspaceFile[] = contextFiles.map((file) => ({
    key: `context:${file.fileKey}`,
    title: `${titleCase(file.fileKey)}.md`,
    category: CONTEXT_FILE_CATEGORIES[file.fileKey],
    content: file.content,
    updatedAt: file.updatedAt,
  }));

  const skillEntries: WorkspaceFile[] = skills.map((skill) => ({
    key: `skill:${skill.skillKey}`,
    title: `${titleCase(skill.skillKey)} (skill, v${skill.version})`,
    category: "Other",
    content: skill.content,
    updatedAt: skill.updatedAt,
  }));

  return [...contextEntries, ...skillEntries].sort((a, b) => a.title.localeCompare(b.title));
}

// Lightweight signal for the launch-plan widget (lib/launch-plan.ts) — it
// only needs which context-file keys exist and whether any skill is
// installed, not their full content.
export async function fetchLaunchPlanSignals(
  businessId: Id<"businesses">,
): Promise<{ contextFileKeys: string[]; hasSkill: boolean }> {
  const client = getDashboardConvexClient();
  const secret = getConvexServiceSecret();
  const [contextFiles, skills] = await Promise.all([
    client.action(api.agentContextFilesActions.listByBusiness, { businessId, secret }),
    client.action(api.agentSkillsActions.listByBusiness, { businessId, secret }),
  ]);
  return {
    contextFileKeys: contextFiles.map((file) => file.fileKey),
    hasSkill: skills.length > 0,
  };
}
