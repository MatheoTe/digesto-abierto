"use client";

import { Check, Combine, FileSearch, ListOrdered, PenLine, Sparkles, Waypoints } from "lucide-react";
import { motion } from "motion/react";
import type { PipelineStage } from "@/lib/ask-events";
import { cn, formatMs } from "@/lib/utils";
import { PIPELINE, type StageMap } from "./use-ask";

const META: Record<PipelineStage, { label: string; icon: typeof Check; hint: string }> = {
  rewrite: { label: "Entender", icon: PenLine, hint: "Reformula la pregunta con el vocabulario de las ordenanzas" },
  fts: { label: "Palabras", icon: FileSearch, hint: "Búsqueda por palabras en español (Postgres)" },
  vector: { label: "Significado", icon: Waypoints, hint: "Búsqueda por significado (pgvector)" },
  fuse: { label: "Combinar", icon: Combine, hint: "Fusión de rankings (Reciprocal Rank Fusion)" },
  rerank: { label: "Ordenar", icon: ListOrdered, hint: "Reordena los candidatos por relevancia" },
  generate: { label: "Responder", icon: Sparkles, hint: "Respuesta citando cada artículo" },
};

/** Live view of the query pipeline: each stage lights up as its `stage` event arrives, with its timing. */
export function PipelineView({ stages, compact = false }: { stages: StageMap; compact?: boolean }) {
  // A words-only deployment skips the vector stage: leave it out instead of showing a dash.
  const visible = PIPELINE.filter((s) => !(s === "vector" && stages.vector.status === "skipped"));
  const reached = visible.filter((s) => stages[s].status !== "idle").length;
  const rewrite = stages.rewrite.detail;
  return (
    <div className="space-y-2" data-testid="pipeline">
      <ol className="relative grid gap-1.5" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}>
        <span className="absolute inset-x-[8%] top-[15px] h-px bg-border" aria-hidden="true" />
        <motion.span
          aria-hidden="true"
          className="absolute left-[8%] top-[15px] h-px bg-gradient-to-r from-primary/40 via-primary to-vector"
          initial={{ width: 0 }}
          animate={{ width: `${(Math.max(0, reached - 1) / (visible.length - 1)) * 84}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
        {visible.map((stage) => {
          const state = stages[stage];
          const { label, icon: Icon, hint } = META[stage];
          const running = state.status === "running";
          const done = state.status === "done";
          const skipped = state.status === "skipped";
          return (
            <li key={stage} className="relative flex flex-col items-center gap-1.5 text-center" title={hint} data-stage={stage} data-status={state.status}>
              <span
                className={cn(
                  "relative grid size-[30px] place-items-center rounded-full border text-muted-foreground transition-all duration-500",
                  "bg-card-solid",
                  running && "border-primary/60 text-primary shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_18%,transparent),0_0_24px_-4px_var(--primary)]",
                  done && "border-primary/40 bg-primary/15 text-primary",
                  skipped && "border-dashed opacity-50",
                )}
              >
                {running && <span className="absolute inset-0 animate-ping rounded-full border border-primary/40" />}
                {done ? <Check className="size-3.5" strokeWidth={2.5} /> : <Icon className="size-3.5" />}
              </span>
              <span className={cn("text-[11px] font-medium leading-none", done || running ? "text-foreground" : "text-muted-foreground", compact && "text-[10.5px]")}>
                {label}
              </span>
              <span className="h-3 font-mono text-[10px] leading-none tabular-nums text-muted-foreground">
                {done ? formatMs(state.ms ?? 0) : running ? <span className="shimmer inline-block h-2 w-8 rounded" /> : skipped ? "—" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      {rewrite && !compact && (
        <p className="truncate text-center text-[11px] text-muted-foreground">
          buscando{" "}
          {rewrite.split("\n").map((line, i) => (
            <span key={line}>
              {i > 0 && " · "}
              <span className="font-mono text-foreground/80">“{line}”</span>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
