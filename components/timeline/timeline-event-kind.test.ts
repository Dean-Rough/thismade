import { describe, expect, it } from "vitest";
import { KNOWN_TIMELINE_EVENT_KINDS, resolveTimelineCardKind } from "./timeline-event-kind";

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
