"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AskEvent, HistoryTurn, PipelineStage, SourceView, StageStatus, TimingsView } from "@/lib/ask-events";

export interface StageState {
  status: StageStatus | "idle";
  ms?: number;
  detail?: string;
}

export type StageMap = Record<PipelineStage, StageState>;

export interface Turn {
  id: string;
  question: string;
  status: "streaming" | "done" | "error";
  answer: string;
  sources: SourceView[];
  citedIndices: number[];
  answerable: boolean | null;
  traceId: string | null;
  timings: TimingsView | null;
  costUsd: number | null;
  error: string | null;
  stages: StageMap;
  startedAt: number;
}

export const PIPELINE: PipelineStage[] = ["rewrite", "fts", "vector", "fuse", "rerank", "generate"];

const idleStages = (): StageMap =>
  Object.fromEntries(PIPELINE.map((s) => [s, { status: "idle" }])) as StageMap;

const blankTurn = (id: string, question: string): Turn => ({
  id,
  question,
  status: "streaming",
  answer: "",
  sources: [],
  citedIndices: [],
  answerable: null,
  traceId: null,
  timings: null,
  costUsd: null,
  error: null,
  stages: idleStages(),
  startedAt: Date.now(),
});

/** Conversation state driven by the NDJSON event stream of POST /api/ask. */
export function useAsk() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnsRef = useRef<Turn[]>([]);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  const abortRef = useRef<AbortController | null>(null);

  const update = (id: string, patch: (t: Turn) => Partial<Turn>) =>
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch(t) } : t)));

  const run = useCallback(async (id: string, question: string, history: HistoryTurn[]) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const apply = (event: AskEvent) => {
      switch (event.type) {
        case "meta":
          update(id, () => ({ traceId: event.traceId }));
          break;
        case "stage":
          update(id, (t) => ({
            stages: { ...t.stages, [event.stage]: { status: event.status, ms: event.ms, detail: event.detail ?? t.stages[event.stage].detail } },
          }));
          break;
        case "sources":
          update(id, () => ({ sources: event.sources }));
          break;
        case "delta":
          update(id, (t) => ({ answer: t.answer + event.text }));
          break;
        case "done":
          update(id, () => ({
            status: "done",
            answer: event.answer,
            answerable: event.answerable,
            citedIndices: event.citations.map((c) => c.index),
            timings: event.timings,
            costUsd: event.costUsd,
          }));
          break;
        case "error":
          update(id, () => ({ status: "error", error: event.error.message }));
          break;
      }
    };

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, ...(history.length && { history }) }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        update(id, () => ({ status: "error", error: body?.error?.message ?? `No se pudo responder (error ${res.status})` }));
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) apply(JSON.parse(line) as AskEvent);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") update(id, () => ({ status: "error", error: "Se cortó la conexión. Probá de nuevo." }));
    }
  }, []);

  const historyBefore = (index: number): HistoryTurn[] =>
    turnsRef.current
      .slice(0, index)
      .filter((t) => t.status === "done")
      .slice(-3)
      .map((t) => ({ question: t.question, answer: t.answer.slice(0, 4000) }));

  const ask = useCallback(
    (question: string) => {
      const id = crypto.randomUUID();
      const history = historyBefore(turnsRef.current.length);
      setTurns((prev) => [...prev, blankTurn(id, question)]);
      void run(id, question, history);
    },
    [run],
  );

  const regenerate = useCallback(
    (id: string) => {
      const index = turnsRef.current.findIndex((t) => t.id === id);
      if (index < 0) return;
      const question = turnsRef.current[index].question;
      setTurns((prev) => prev.map((t) => (t.id === id ? blankTurn(id, question) : t)));
      void run(id, question, historyBefore(index));
    },
    [run],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
  }, []);

  return { turns, ask, regenerate, reset, busy: turns.some((t) => t.status === "streaming") };
}
