import { MessageSquare } from "lucide-react";
import { TimelineCardShell } from "../card-shell";
import type { AgentEventDoc } from "../timeline-event-kind";

export function ChatMessageCard({
  event,
  data,
}: {
  event: AgentEventDoc;
  data: Extract<AgentEventDoc["event"], { kind: "chat_message" }>;
}) {
  return (
    <TimelineCardShell event={event} icon={MessageSquare}>
      <p className="whitespace-pre-wrap">{data.text}</p>
    </TimelineCardShell>
  );
}
