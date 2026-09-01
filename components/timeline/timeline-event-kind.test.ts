import { describe, expect, it } from "vitest";
import {
  KNOWN_TIMELINE_EVENT_KINDS,
  isPendingApprovalLive,
  resolveTimelineCardKind,
} from "./timeline-event-kind";

describe("resolveTimelineCardKind", () => {
  it.each(KNOWN_TIMELINE_EVENT_KINDS)("resolves the real wire kind %s to itself", (kind) => {
    expect(resolveTimelineCardKind({ kind })).toBe(kind);
  });

  it("falls back to unknown for a kind this build has never seen", () => {
    expect(resolveTimelineCardKind({ kind: "some_future_kind" })).toBe("unknown");
  });

  it("falls back to unknown for THI-14's originally-planned (never-shipped) type names", () => {
    // DECISIONS.md: richContent kind names are deliberately not MadeThis's
    // captured vocabulary — these must never accidentally match.
    for (const plannedType of ["briefing", "task_dispatch", "milestone", "owner_secret_request"]) {
      expect(resolveTimelineCardKind({ kind: plannedType })).toBe("unknown");
    }
  });

  it("never throws on a malformed/empty kind", () => {
    expect(() => resolveTimelineCardKind({ kind: "" })).not.toThrow();
    expect(resolveTimelineCardKind({ kind: "" })).toBe("unknown");
  });
});

describe("isPendingApprovalLive", () => {
  const event = { toolName: "delete_storefront_files", argsSummary: '{"path":"/all"}' };

  it("is live when the task's current pendingApproval matches this event", () => {
    expect(isPendingApprovalLive(event, { ...event })).toBe(true);
  });

  it("is not live when the task has no pendingApproval at all", () => {
    expect(isPendingApprovalLive(event, undefined)).toBe(false);
  });

  // The confused-deputy case a real worker run produces (THI-89): task
  // pauses, gets approved, resumes, and pauses again on a *different*
  // destructive call. The first event must not re-render as approvable just
  // because the task is pending again.
  it("is not live when the task is pending on a different tool call", () => {
    const laterApproval = { toolName: "stripe_refund_all", argsSummary: '{"orderId":"all"}' };
    expect(isPendingApprovalLive(event, laterApproval)).toBe(false);
  });

  it("is not live when only the args summary differs", () => {
    expect(isPendingApprovalLive(event, { ...event, argsSummary: '{"path":"/other"}' })).toBe(false);
  });
});
