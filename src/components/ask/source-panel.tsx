"use client";

import Link from "next/link";
import { ArrowUpRight, ExternalLink, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScoreBar } from "@/components/ui/score-bar";
import type { SourceView } from "@/lib/ask-events";
import { cn } from "@/lib/utils";
import { HighlightedPassage } from "./passage";
import { sourceTitle } from "./source-card";
import { StatusBadges } from "./status-badges";

interface OrdinanceChunk {
  id: string;
  ordinal: number;
  kind: string;
  label: string | null;
  content: string;
  headingPath: string;
}

interface Props {
  source: SourceView;
  claim: string | null;
  /** Best fused score among this answer's sources (to scale the bar). */
  maxFused: number;
  candidates?: number;
  onClose: () => void;
}

/**
 * Slide-over view of the cited ordinance: loads its articles, scrolls to the
 * cited one and highlights the sentence that supports the claim. Below, how
 * the passage was found (full-text rank, vector rank, fused score).
 */
export function SourcePanel({ source, claim, maxFused, candidates = 30, onClose }: Props) {
  const [chunks, setChunks] = useState<OrdinanceChunk[] | null>(null);
  const targetRef = useRef<HTMLLIElement>(null);
  const isRecord = source.kind === "record";

  useEffect(() => {
    if (isRecord) return;
    let cancelled = false;
    fetch(`/api/ordenanzas/${source.ordinanceNumber}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { ordinance?: { chunks: OrdinanceChunk[] } } | null) => {
        if (!cancelled) setChunks(body?.ordinance?.chunks ?? []);
      })
      .catch(() => !cancelled && setChunks([]));
    return () => {
      cancelled = true;
    };
  }, [source.ordinanceNumber, isRecord]);

  useEffect(() => {
    targetRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [chunks, source.chunkId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const own = { id: source.chunkId, ordinal: 0, kind: source.kind, label: source.label, content: source.content, headingPath: source.headingPath };
  const list = !isRecord && chunks?.length ? chunks : [own];

  return (
    <>
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        data-testid="source-panel"
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
        className="surface fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col rounded-none sm:inset-y-3 sm:right-3 sm:rounded-2xl"
        style={{ background: "color-mix(in oklch, var(--card-solid) 97%, transparent)" }}
        aria-label="Fuente citada"
      >
        <div className="flex items-start gap-3 border-b border-border/70 p-5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-mono text-sm font-semibold text-primary-foreground">
            {source.index}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[15px] font-semibold">{sourceTitle(source)}</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{source.ordinanceSummary}</p>
            <div className="mt-2.5">
              <StatusBadges source={source} />
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar">
            <X />
          </Button>
        </div>

        <ol className="flex-1 space-y-2 overflow-y-auto px-5 py-4" data-testid="source-document">
          {list.map((chunk) => {
            const target = chunk.id === source.chunkId;
            const where = [chunk.headingPath.split(" > ").join(" › "), chunk.label].filter(Boolean).join(" · ");
            return (
              <li
                key={chunk.id}
                ref={target ? targetRef : undefined}
                className={cn(
                  "rounded-xl border border-transparent px-3.5 py-3 text-[13px] leading-relaxed transition-colors",
                  target ? "border-primary/35 bg-primary/8 shadow-[var(--shadow-glow)]" : "text-foreground/55",
                )}
              >
                <p className="mb-1.5 flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  <span className="truncate">{where || "—"}</span>
                  {target && <span className="ml-auto shrink-0 font-semibold text-primary">citado</span>}
                </p>
                {target ? (
                  <HighlightedPassage content={chunk.content} claim={claim} className="whitespace-pre-wrap" />
                ) : (
                  <p className="whitespace-pre-wrap">{chunk.content}</p>
                )}
              </li>
            );
          })}
        </ol>

        <details className="border-t border-border/70 px-5 py-3 text-xs">
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">Cómo se encontró este fragmento</summary>
          <div className="mt-3 space-y-2">
            <ScoreBar
              label="Palabras"
              tone="fts"
              value={source.ftsRank ? 1 - (source.ftsRank - 1) / candidates : 0}
              display={source.ftsRank ? `#${source.ftsRank}` : "—"}
            />
            <ScoreBar label="Significado" tone="vector" value={source.vectorSimilarity ?? 0} display={source.vectorRank ? `#${source.vectorRank}` : "—"} />
            <ScoreBar label="Combinado" value={maxFused ? source.fusedScore / maxFused : 0} display={source.fusedScore.toFixed(4)} />
            {source.rerankScore !== null && <ScoreBar label="Reordenado" value={source.rerankScore} display={source.rerankScore.toFixed(2)} />}
          </div>
        </details>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-5 py-3">
          {source.textUrl ? (
            <Button asChild variant="link" size="sm" className="px-0">
              <a href={source.textUrl} target="_blank" rel="noreferrer">
                Texto oficial en el Concejo <ExternalLink />
              </a>
            </Button>
          ) : (
            <span />
          )}
          <Button asChild variant="link" size="sm" className="px-0">
            <Link href={`/ordenanza/${source.ordinanceNumber}${isRecord ? "" : `#frag-${source.chunkId}`}`}>
              Ver la ordenanza completa <ArrowUpRight />
            </Link>
          </Button>
        </div>
      </motion.aside>
    </>
  );
}
