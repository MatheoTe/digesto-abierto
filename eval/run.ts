/**
 * Digesto Abierto evaluation, over the real corpus in DATABASE_URL.
 *
 *   npm run eval                         retrieval, answers, faithfulness judge and closed-book baseline
 *   npm run eval -- --retrieval-only     only the search (cheap: rewrite + embeddings)
 *   npm run eval -- --only taxi-turno,fumar-bar
 *
 * The closed-book baseline asks the same answer model the same questions with
 * no sources at all: what you would get asking a general chatbot.
 *
 * Writes eval/reports/latest.json (every question) and eval/reports/summary.json
 * (the headline numbers shown on /como-funciona).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { eq, inArray } from "drizzle-orm";
import { isAbstention } from "@/lib/citations";
import type { AskEvent, SourceView } from "@/lib/ask-events";
import { getEnv } from "@/server/config/env";
import { createDb } from "@/server/db/client";
import { chunks, traces } from "@/server/db/schema";
import { answerQuestion, toPassage } from "@/server/generation/answer";
import { describeProviders, resolveProviders } from "@/server/providers";
import { referencedOrdinances, retrieve } from "@/server/retrieval/hybrid";
import { loadGoldenSet, type GoldenQuestion } from "./dataset";
import { citationPrecision, containsKeyFacts, isRelevant, matchesItem, mean, namedOrdinances, recallAtK, reciprocalRank } from "./metrics";

const argv = process.argv.slice(2);
const RETRIEVAL_ONLY = argv.includes("--retrieval-only");
const ONLY = argv.includes("--only") ? new Set(argv[argv.indexOf("--only") + 1].split(",")) : null;
const K = 8;
const PARALLEL = 3;

const CLOSED_BOOK_SYSTEM = `Respondé preguntas sobre las ordenanzas municipales del Partido de General Pueyrredon (Mar del Plata, Argentina). Respondé en español, en pocas oraciones, nombrando el número de ordenanza y el artículo en que te basás. Si no sabés la respuesta, decilo.`;

interface Row {
  id: string;
  question: string;
  answerable: boolean;
  tags: string[];
  recall: number;
  rr: number;
  retrieved: string[];
  answer?: string;
  abstained?: boolean;
  keyFacts?: boolean;
  citedRelevant?: boolean;
  citationPrecision?: number | null;
  faithfulness?: number | null;
  unsupported?: string[];
  costUsd?: number | null;
  totalMs?: number;
  closedBook?: { answer: string; named: number[]; correctOrdinance: boolean; wrongOrdinance: boolean; keyFacts: boolean };
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function main() {
  const env = getEnv();
  const providers = resolveProviders(env);
  const mode = describeProviders(providers);
  console.log(`modelos: ${JSON.stringify(mode)}`);
  if (!RETRIEVAL_ONLY && providers.llm.name !== "anthropic") throw new Error("La evaluación completa necesita ANTHROPIC_API_KEY");
  const handle = await createDb(env.DATABASE_URL);
  const db = handle.db;
  const questions = (await loadGoldenSet()).filter((q) => !ONLY || ONLY.has(q.id));

  // Guard against label rot: every evidence string must exist in its ordinance.
  const needed = [...new Set(questions.flatMap((q) => q.expected.map((e) => e.ordinance)))];
  const stored = await db
    .select({ ordinanceNumber: chunks.ordinanceNumber, content: chunks.content })
    .from(chunks)
    .where(inArray(chunks.ordinanceNumber, needed.length ? needed : [-1]));
  const missing = questions.flatMap((q) =>
    q.expected.filter((item) => !stored.some((c) => matchesItem(c, item))).map((item) => `${q.id} → Ordenanza ${item.ordinance}: ${item.evidence.join(" | ") || "(sin fragmentos)"}`),
  );
  if (missing.length) throw new Error(`etiquetas del set que no están en el corpus:\n  ${missing.join("\n  ")}`);

  const anthropic = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 4 }) : null;

  const evaluate = async (q: GoldenQuestion): Promise<Row> => {
    let sources: SourceView[] = [];
    const row: Row = { id: q.id, question: q.question, answerable: q.answerable, tags: q.tags, recall: 0, rr: 0, retrieved: [] };

    if (RETRIEVAL_ONLY) {
      const rewrite = await providers.llm.rewriteQuery(q.question);
      const res = await retrieve({ db, embeddings: providers.embeddings, reranker: providers.reranker }, rewrite.query, {
        k: K,
        question: q.question,
        ordinanceNumbers: [...new Set([...referencedOrdinances(q.question), ...referencedOrdinances(rewrite.query)])],
      });
      sources = res.chunks.map((c, i) => ({ ...c, index: i + 1 }) as SourceView);
    } else {
      const outcome = await answerQuestion({ db, providers }, { question: q.question, k: K }, (e: AskEvent) => {
        if (e.type === "sources") sources = e.sources;
      });
      const [trace] = await db.select({ costUsd: traces.costUsd, totalMs: traces.totalMs }).from(traces).where(eq(traces.id, outcome.traceId));
      const cited = outcome.citations.map((c) => sources[c.index - 1]);
      row.answer = outcome.answer;
      row.abstained = !outcome.answerable || isAbstention(outcome.answer);
      row.keyFacts = containsKeyFacts(outcome.answer, q.mustInclude);
      row.citedRelevant = cited.some((c) => isRelevant(c, q));
      row.citationPrecision = citationPrecision(cited, q);
      row.costUsd = trace?.costUsd ?? null;
      row.totalMs = trace?.totalMs;
      if (providers.judge && !row.abstained && cited.length) {
        const verdict = await providers.judge.judge({ question: q.question, answer: outcome.answer, sources: sources.map(toPassage) });
        row.faithfulness = verdict.score;
        row.unsupported = verdict.unsupportedClaims;
      }
      if (anthropic && q.answerable) {
        const res = await anthropic.messages.create({
          model: env.DIGESTO_ANSWER_MODEL,
          max_tokens: 800,
          system: CLOSED_BOOK_SYSTEM,
          messages: [{ role: "user", content: q.question }],
        });
        const answer = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
        const named = namedOrdinances(answer);
        const expected = new Set(q.expected.map((e) => e.ordinance));
        row.closedBook = {
          answer,
          named,
          correctOrdinance: named.some((n) => expected.has(n)),
          wrongOrdinance: named.length > 0 && !named.some((n) => expected.has(n)),
          keyFacts: containsKeyFacts(answer, q.mustInclude),
        };
      }
    }
    row.recall = recallAtK(sources, q, K);
    row.rr = reciprocalRank(sources, q);
    row.retrieved = sources.map((s) => `${s.ordinanceNumber}${s.label ? ` ${s.label}` : ""}`);
    const mark = q.answerable ? (row.recall ? "✓" : "✗") : row.abstained === undefined ? "·" : row.abstained ? "✓" : "✗";
    console.log(`${mark} ${q.id.padEnd(28)} recall@${K}=${row.recall} rr=${row.rr.toFixed(2)}${row.answer !== undefined ? ` hechos=${row.keyFacts ? "sí" : "no"} fiel=${row.faithfulness?.toFixed(2) ?? "-"}` : ""}`);
    return row;
  };

  const rows = await pool(questions, PARALLEL, evaluate);
  await handle.close();

  const answerable = rows.filter((r) => r.answerable);
  const unanswerable = rows.filter((r) => !r.answerable);
  const pick = <T>(xs: Row[], f: (r: Row) => T | undefined | null) => xs.map(f).filter((v): v is T => v !== undefined && v !== null);
  const share = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : null);

  const summary = {
    runAt: new Date().toISOString(),
    providers: mode,
    questions: rows.length,
    answerable: answerable.length,
    unanswerable: unanswerable.length,
    retrievalRecallAt8: mean(answerable.map((r) => r.recall)),
    mrr: mean(answerable.map((r) => r.rr)),
    citedCorrectOrdinance: RETRIEVAL_ONLY ? null : share(pick(answerable, (r) => (r.citedRelevant ?? false) && !r.abstained)),
    keyFacts: RETRIEVAL_ONLY ? null : share(pick(answerable, (r) => r.keyFacts)),
    falseAbstentions: RETRIEVAL_ONLY ? null : share(pick(answerable, (r) => r.abstained)),
    correctAbstentions: RETRIEVAL_ONLY ? null : share(pick(unanswerable, (r) => r.abstained)),
    citationPrecision: RETRIEVAL_ONLY ? null : mean(pick(answerable, (r) => r.citationPrecision)),
    faithfulness: RETRIEVAL_ONLY ? null : mean(pick(rows, (r) => r.faithfulness)),
    avgCostUsd: RETRIEVAL_ONLY ? null : mean(pick(rows, (r) => r.costUsd)),
    avgLatencyMs: RETRIEVAL_ONLY ? null : mean(pick(rows, (r) => r.totalMs)),
    closedBook: RETRIEVAL_ONLY
      ? null
      : {
          correctOrdinance: share(pick(answerable, (r) => r.closedBook?.correctOrdinance)),
          inventedOrdinances: share(pick(answerable, (r) => r.closedBook?.wrongOrdinance)),
          keyFacts: share(pick(answerable, (r) => r.closedBook?.keyFacts)),
        },
  };

  const dir = path.resolve("eval/reports");
  await mkdir(dir, { recursive: true });
  const report = JSON.stringify({ summary, rows }, null, 2);
  await writeFile(path.join(dir, `eval-${summary.runAt.replace(/[:.]/g, "-")}.json`), report);
  if (!ONLY) {
    await writeFile(path.join(dir, "latest.json"), report);
    if (!RETRIEVAL_ONLY) await writeFile(path.join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  }
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? "  -  " : `${(v * 100).toFixed(0).padStart(3)}%`);
  console.log(`
${rows.length} preguntas (${answerable.length} con respuesta, ${unanswerable.length} sin respuesta en el digesto)
  artículo correcto entre los ${K} primeros   ${pct(summary.retrievalRecallAt8)}   MRR ${summary.mrr?.toFixed(3)}
  cita la ordenanza correcta                ${pct(summary.citedCorrectOrdinance)}   (sin el digesto: ${pct(summary.closedBook?.correctOrdinance)})
  incluye los datos clave                   ${pct(summary.keyFacts)}   (sin el digesto: ${pct(summary.closedBook?.keyFacts)})
  nombra una ordenanza equivocada           ${"  -  "}   (sin el digesto: ${pct(summary.closedBook?.inventedOrdinances)})
  se abstiene cuando corresponde            ${pct(summary.correctAbstentions)}
  se abstiene cuando no corresponde         ${pct(summary.falseAbstentions)}
  precisión de las citas                    ${pct(summary.citationPrecision)}
  fidelidad a las fuentes (juez)            ${pct(summary.faithfulness)}
  costo medio US$ ${summary.avgCostUsd?.toFixed(4) ?? "-"} · latencia media ${summary.avgLatencyMs ? Math.round(summary.avgLatencyMs) : "-"} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
