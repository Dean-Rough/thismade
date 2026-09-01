"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import type { WorkspaceFile, WorkspaceFileCategory } from "@/lib/api/dashboardFiles";

const CATEGORY_ORDER: WorkspaceFileCategory[] = ["Identity", "Operations", "Evolving", "Other"];

export function FilesBrowser({ files }: { files: WorkspaceFile[] }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(files[0]?.key ?? null);
  const selected = files.find((f) => f.key === selectedKey) ?? null;

  return (
    <div className="flex h-full">
      <nav className="w-64 shrink-0 overflow-y-auto border-r border-border">
        {CATEGORY_ORDER.map((category) => {
          const inCategory = files.filter((f) => f.category === category);
          if (inCategory.length === 0) return null;
          return (
            <div key={category} className="p-3">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
                {category}
              </p>
              <ul className="space-y-0.5">
                {inCategory.map((file) => (
                  <li key={file.key}>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(file.key)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink",
                        selectedKey === file.key && "bg-surface-raised font-medium text-ink",
                      )}
                    >
                      <FileText className="size-3.5 shrink-0" />
                      <span className="truncate">{file.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <article
            className={cn(
              "max-w-2xl space-y-3 text-sm leading-relaxed text-ink",
              "[&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-4",
              "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-4",
              "[&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-3",
              "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
              "[&_code]:rounded [&_code]:bg-surface-raised [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
              "[&_pre]:overflow-x-auto [&_pre]:rounded-card [&_pre]:bg-surface-raised [&_pre]:p-3",
              "[&_a]:text-accent [&_a]:underline",
            )}
          >
            <ReactMarkdown>{selected.content}</ReactMarkdown>
          </article>
        ) : (
          <p className="text-sm text-ink-muted">No workspace files yet.</p>
        )}
      </div>
    </div>
  );
}
