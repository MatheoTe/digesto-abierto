import { randomUUID } from "node:crypto";
import { ABSTAIN_ANSWER, extractCitations, isAbstention } from "@/lib/citations";
import type { AskEvent, HistoryTurn, PipelineStage, SourceView, StageStatus } from "@/lib/ask-events";
import type { Db } from "../db/client";
import { traces, type TraceCitation, type TraceTimings, type TraceUsageEntry } from "../db/schema";
import { errorMessage, toErrorBody } from "../errors";
import { llmCostUsd, tokenCostUsd } from "../observability/pricing";
import { describeProviders, type Providers } from "../providers";
import type { LlmUsage } from "../providers/llm/types";
import { referencedOrdinances, retrieve, type RetrievedChunk } from "../retrieval/hybrid";
import type { SourcePassage } from "./prompt";

export interface AskInput {
  question: string;
  k: number;
  /** Earlier turns of the conversation (oldest first) for follow-up questions. */
  history?: HistoryTurn[];
}

export interface AskDeps {
  db: Db;
  providers: Providers;
}

export interface AskOutcome {
  traceId: string;
  answer: string;
  answerable: boolean;
  sources: SourceView[];
  citations: TraceCitation[];
}

function usageEntry(step: TraceUsageEntry["step"], usage: LlmUsage): TraceUsageEntry {
  return { step, ...usage, costUsd: llmCostUsd(usage) };
}

function toSourceView(chunk: RetrievedChunk, index: number): SourceView {
  return {
    index,
    chunkId: chunk.chunkId,
    ordinanceNumber: chunk.ordinanceNumber,
    ordinanceSummary: chunk.ordinanceSummary,
    sanctionedOn: chunk.sanctionedOn,
    inForce: chunk.inForce,
    repealedBy: chunk.repealedBy,
    textSource: chunk.textSource,
    textUrl: chunk.textUrl,
    laterAmendments: chunk.laterAmendments,
    kind: chunk.kind,
    label: chunk.label,
    headingPath: chunk.headingPath,
    content: chunk.content,
    ftsRank: chunk.ftsRank,
    vectorRank: chunk.vectorRank,
    vectorSimilarity: chunk.vectorSimilarity,
    fusedScore: chunk.fusedScore,
    rerankScore: chunk.rerankScore,
  };
}

export function toPassage(source: SourceView): SourcePassage {
  return {
    index: source.index,
    ordinanceNumber: source.ordinanceNumber,
    sanctionedOn: source.sanctionedOn,
    inForce: source.inForce,
    repealedBy: source.repealedBy,
    textSource: source.textSource,
    laterAmendments: source.laterAmendments,
    kind: source.kind,
    label: source.label,
    headingPath: source.headingPath,
    content: source.content,
  };
}

/**
 * The query pipeline: rewrite → hybrid retrieve (→ rerank) → grounded,
 * streamed generation → citation validation → trace.
 *
 * Every stage is announced as it starts and finishes (`stage` events drive
 * the live pipeline view), timed with its offset from the start of the
 * request, and every model call is costed. The trace row is written before
 * the final `done` event so the UI can link to it.
 */
export async function answerQuestion(
  deps: AskDeps,
  input: AskInput,
  emit: (event: AskEvent) => void,
  signal?: AbortSignal,
): Promise<AskOutcome> {
  const { db, providers } = deps;
  const traceId = randomUUID();
  const t0 = performance.now();
  const ms = (from: number) => Math.round(performance.now() - from);
  const mode = describeProviders(providers);
  const timings: TraceTimings = {
    rewriteMs: 0,
    embedMs: 0,
    ftsMs: 0,
    vectorMs: 0,
    fuseMs: 0,
    rerankMs: 0,
    retrievalMs: 0,
    ttftMs: null,
    generationMs: 0,
    totalMs: 0,
    spans: [],
  };
  const usage: TraceUsageEntry[] = [];
  const stageStarts = new Map<PipelineStage, number>();
  let rewrittenQuery: string | null = null;
  let retrieved: RetrievedChunk[] = [];
  let answer = "";

  const stage = (name: PipelineStage, status: StageStatus, durationMs?: number, detail?: string) => {
    if (status === "running") stageStarts.set(name, ms(t0));
    if (status === "done") {
      const duration = durationMs ?? 0;
      const startMs = stageStarts.get(name) ?? Math.max(0, ms(t0) - duration);
      timings.spans!.push({ stage: name, startMs, durationMs: duration });
    }
    emit({ type: "stage", stage: name, status, ...(durationMs !== undefined && { ms: durationMs }), ...(detail && { detail }) });
  };

  emit({ type: "meta", traceId, mode });

  try {
    stage("rewrite", "running");
    let start = performance.now();
    const rewrite = await providers.llm.rewriteQuery(input.question, input.history);
    timings.rewriteMs = ms(start);
    rewrittenQuery = rewrite.query;
    if (rewrite.usage) usage.push(usageEntry("rewrite", rewrite.usage));
    stage("rewrite", "done", timings.rewriteMs, rewrittenQuery);

    start = performance.now();
    const retrieval = await retrieve(
      { db, embeddings: providers.embeddings, reranker: providers.reranker },
      rewrittenQuery,
      {
        k: input.k,
        // Numbers named in the question itself; the rewrite may drop or reformat them.
        ordinanceNumbers: [...new Set([...referencedOrdinances(input.question), ...referencedOrdinances(rewrittenQuery)])],
        onStage: (name, status, d) => stage(name, status, d),
      },
    );
    timings.retrievalMs = ms(start);
    Object.assign(timings, retrieval.timings);
    retrieved = retrieval.chunks;
    if (retrieval.embedTokens) {
      usage.push({
        step: "embed",
        model: providers.embeddings.model,
        inputTokens: retrieval.embedTokens,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: tokenCostUsd(providers.embeddings.model, retrieval.embedTokens),
      });
    }
    if (retrieval.rerankTokens && providers.reranker) {
      usage.push({
        step: "rerank",
        model: providers.reranker.model,
        inputTokens: retrieval.rerankTokens,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: tokenCostUsd(providers.reranker.model, retrieval.rerankTokens),
      });
    }

    const sources = retrieved.map((c, i) => toSourceView(c, i + 1));
    emit({ type: "sources", sources });

    let refused = false;
    stage("generate", "running");
    start = performance.now();
    if (sources.length === 0) {
      // Nothing retrieved: abstain without paying for a generation call.
      answer = ABSTAIN_ANSWER;
      emit({ type: "delta", text: answer });
    } else {
      const result = await providers.llm.streamAnswer(
        { question: input.question, sources: sources.map(toPassage), history: input.history, signal },
        (text) => {
          timings.ttftMs ??= ms(t0);
          emit({ type: "delta", text });
        },
      );
      answer = result.text;
      refused = result.refused;
      if (result.usage) usage.push(usageEntry("answer", result.usage));
    }
    timings.generationMs = ms(start);
    stage("generate", "done", timings.generationMs);

    const { cited, invalid } = extractCitations(answer, sources.length);
    const citations: TraceCitation[] = cited.map((index) => ({ index, chunkId: sources[index - 1].chunkId }));
    const answerable = !refused && !isAbstention(answer);
    timings.totalMs = ms(t0);
    const costUsd = sumCost(usage);

    await db.insert(traces).values({
      id: traceId,
      question: input.question,
      rewrittenQuery,
      answer,
      answerable,
      status: "ok",
      llmProvider: providers.llm.name,
      llmModel: usage.find((u) => u.step === "answer")?.model ?? providers.llm.answerModel,
      embeddingModel: providers.embeddings.model,
      reranker: providers.reranker?.model ?? null,
      timings,
      retrieval: retrieved.map((c) => ({
        chunkId: c.chunkId,
        ordinanceNumber: c.ordinanceNumber,
        ftsRank: c.ftsRank,
        vectorRank: c.vectorRank,
        fusedScore: c.fusedScore,
        rerankScore: c.rerankScore,
      })),
      citations,
      usage,
      costUsd,
      totalMs: timings.totalMs,
    });

    emit({
      type: "done",
      traceId,
      answer,
      answerable,
      citations,
      invalidCitations: invalid,
      timings,
      costUsd,
    });
    return { traceId, answer, answerable, sources, citations };
  } catch (err) {
    timings.totalMs = ms(t0);
    await db
      .insert(traces)
      .values({
        id: traceId,
        question: input.question,
        rewrittenQuery,
        answer: answer || null,
        answerable: null,
        status: "error",
        error: errorMessage(err).slice(0, 500),
        llmProvider: providers.llm.name,
        llmModel: providers.llm.answerModel,
        embeddingModel: providers.embeddings.model,
        reranker: providers.reranker?.model ?? null,
        timings,
        retrieval: [],
        citations: [],
        usage,
        costUsd: sumCost(usage),
        totalMs: timings.totalMs,
      })
      .catch((traceErr) => console.error("[digesto] failed to persist error trace", traceErr));
    emit({ type: "error", error: toErrorBody(err).body.error });
    throw err;
  }
}

function sumCost(usage: TraceUsageEntry[]): number | null {
  if (usage.length === 0) return 0;
  if (usage.some((u) => u.costUsd === null)) return null;
  return usage.reduce((n, u) => n + (u.costUsd ?? 0), 0);
}
