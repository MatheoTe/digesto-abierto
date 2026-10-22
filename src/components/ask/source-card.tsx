"use client";

import { motion } from "motion/react";
import type { SourceView } from "@/lib/ask-events";
import { cn } from "@/lib/utils";
import { StatusBadges } from "./status-badges";

interface Props {
  source: SourceView;
  cited: boolean;
  active: boolean;
  order: number;
  onOpen: () => void;
}

/** "Ordenanza 4471 · Art. 16º" and what that ordinance is about. */
export function sourceTitle(source: Pick<SourceView, "ordinanceNumber" | "label" | "kind">): string {
  return source.kind === "record" || !source.label ? `Ordenanza ${source.ordinanceNumber}` : `Ordenanza ${source.ordinanceNumber} · ${source.label}`;
}

export function SourceCard({ source, cited, active, order, onOpen }: Props) {
  return (
    <motion.button
      type="button"
      data-testid="source-card"
      onClick={onOpen}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: order * 0.045, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn(
        "surface surface-interactive group flex w-full flex-col gap-2 rounded-xl p-3.5 text-left",
        active && "shadow-[var(--shadow-elevated),var(--shadow-glow)]",
        !cited && "opacity-80",
      )}
    >
      <span className="flex items-start gap-2.5">
        <span
          className={cn(
            "grid size-[22px] shrink-0 place-items-center rounded-md font-mono text-[11px] font-semibold",
            cited ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {source.index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">{sourceTitle(source)}</span>
          <span className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{source.ordinanceSummary}</span>
        </span>
      </span>
      <StatusBadges source={source} />
    </motion.button>
  );
}
