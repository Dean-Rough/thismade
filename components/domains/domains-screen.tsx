"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Clock, Copy, Plus, XCircle } from "lucide-react";
import { addDomainAction, verifyDomainAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Domain, DnsRecord } from "@/lib/api/dashboardDomains";

const STATUS_ICON = { pending: Clock, verified: CheckCircle2, failed: XCircle } as const;
const STATUS_LABEL = { pending: "Pending", verified: "Verified", failed: "Failed" } as const;
const STATUS_TONE = {
  pending: "text-confirmation-pending",
  verified: "text-confirmation-approved",
  failed: "text-confirmation-rejected",
} as const;

// "not yet available" (THI-92 hasn't shipped) is a distinct condition from a
// transient failure — telling someone to "try again" when retrying can never
// help would be a lie, so this message names the real reason instead of
// reusing the generic retry copy other dashboard actions use.
const BACKEND_NOT_READY_MESSAGE =
  "Domain connections aren't wired up yet — the backend for this is still in progress.";

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message === "domains_backend_not_yet_available") {
    return BACKEND_NOT_READY_MESSAGE;
  }
  if (err instanceof Error && err.message === "invalid_hostname") {
    return "That doesn't look like a valid domain — try something like store.example.com.";
  }
  return fallback;
}

function StatusPill({ status }: { status: Domain["status"] }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", STATUS_TONE[status])}>
      <Icon className="size-3.5" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function DomainRow({ domain }: { domain: Domain }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(domain);

  function handleVerify() {
    setError(null);
    startTransition(async () => {
      try {
        const updated = await verifyDomainAction(current.id);
        setCurrent(updated);
      } catch (err) {
        setError(errorMessage(err, "Could not verify that domain — try again."));
      }
    });
  }

  return (
    <div className="rounded-card border border-border bg-surface-raised p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm text-ink">{current.hostname}</p>
          <StatusPill status={current.status} />
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={isPending}
          onClick={handleVerify}
        >
          {isPending ? "Verifying…" : "Verify"}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-confirmation-rejected">{error}</p>}
    </div>
  );
}

function DnsRecordsTable({ records }: { records: DnsRecord[] }) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  function handleCopy(value: string, index: number) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((prev) => (prev === index ? null : prev)), 1500);
    });
  }

  return (
    <div className="mt-3 space-y-1.5 rounded-card border border-border bg-surface p-3">
      <p className="text-xs font-medium text-ink-muted">Add these records at your registrar</p>
      {records.map((record, index) => (
        <div key={`${record.type}-${record.host}`} className="flex items-center gap-2 font-mono text-xs">
          <span className="w-12 shrink-0 text-ink-muted">{record.type}</span>
          <span className="min-w-0 flex-1 truncate text-ink">{record.host}</span>
          <span className="min-w-0 flex-1 truncate text-ink">{record.value}</span>
          <button
            type="button"
            aria-label={`Copy ${record.type} value`}
            onClick={() => handleCopy(record.value, index)}
            className="shrink-0 rounded p-1 text-ink-muted hover:bg-surface-raised hover:text-ink"
          >
            <Copy className="size-3.5" />
          </button>
          {copiedIndex === index && <span className="shrink-0 text-ink-muted">Copied</span>}
        </div>
      ))}
    </div>
  );
}

function AddDomainForm() {
  const [open, setOpen] = useState(false);
  const [hostname, setHostname] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<DnsRecord[] | null>(null);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await addDomainAction(hostname);
        setRecords(result.records);
      } catch (err) {
        setError(errorMessage(err, "Could not add that domain — try again."));
      }
    });
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus /> Add domain
      </Button>
    );
  }

  return (
    <div className="rounded-card border border-border bg-surface-raised p-3">
      <div className="flex items-end gap-2">
        <input
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="store.example.com"
          className="h-9 flex-1 rounded-md border border-border bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <Button size="sm" disabled={isPending || !hostname.trim()} onClick={handleSubmit}>
          {isPending ? "Adding…" : "Add"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-confirmation-rejected">{error}</p>}
      {records && <DnsRecordsTable records={records} />}
    </div>
  );
}

export function DomainsScreen({ domains }: { domains: Domain[] }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-medium text-ink">Domains</h1>
        <p className="text-sm text-ink-muted">
          Connect a custom domain to your storefront and verify it once its DNS records are live.
        </p>
      </div>

      {domains.length === 0 ? (
        <p className="p-6 text-sm text-ink-muted">No domains connected yet.</p>
      ) : (
        <div className="space-y-2">
          {domains.map((domain) => (
            <DomainRow key={domain.id} domain={domain} />
          ))}
        </div>
      )}

      <AddDomainForm />
    </div>
  );
}
