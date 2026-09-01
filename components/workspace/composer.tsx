"use client";

import { useRef, useState, useTransition } from "react";
import { Paperclip, Send } from "lucide-react";
import { sendChatMessageAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";

// THI-17: "do not block input while a worker task is in_progress" — this
// component has no notion of task status at all, deliberately, so there is
// nothing here that could disable it while a worker runs.
export function Composer({ onSent }: { onSent?: () => void }) {
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed && !attachment) return;
    setError(null);
    // No richContent event shape carries a real attachment reference yet
    // (chat_message is text-only, see convex/lib/richContent.ts) — until
    // that lands, an attachment is noted inline as text rather than silently
    // dropped. See DECISIONS.md's THI-17 entry.
    const messageText = attachment ? `${trimmed}\n📎 ${attachment.name}`.trim() : trimmed;
    startTransition(async () => {
      try {
        await sendChatMessageAction(messageText);
        setText("");
        setAttachment(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        onSent?.();
      } catch {
        setError("Could not send that message — try again.");
      }
    });
  }

  return (
    <div className="border-t border-border bg-surface-raised p-3">
      {attachment && (
        <div className="mb-2 flex items-center gap-2 text-xs text-ink-muted">
          <Paperclip className="size-3" />
          {attachment.name}
          <button
            type="button"
            className="text-confirmation-rejected hover:underline"
            onClick={() => setAttachment(null)}
          >
            Remove
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Attach a file"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip />
        </Button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Message your CEO agent…"
          rows={1}
          className="min-h-9 flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <Button type="button" disabled={isPending} onClick={handleSend}>
          <Send /> Send
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-confirmation-rejected">{error}</p>}
    </div>
  );
}
