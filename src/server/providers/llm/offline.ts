import type { HistoryTurn } from "@/lib/ask-events";
import { ABSTAIN_ANSWER } from "@/lib/citations";
import type { SourcePassage } from "../../generation/prompt";
import { splitSentences } from "../../ingest/text";
import { contentTerms } from "../../text/terms";
import type { AnswerRequest, AnswerResult, LlmProvider } from "./types";

/** Interrogatives and filler that carry no evidence ("how many days…"). */
const QUESTION_NOISE = new Set(["much", "many", "long", "often", "kind", "happen", "happens", "mean", "allow", "allowed"]);

/** Words that signal a follow-up leaning on the previous turn ("what about it?"). */
const FOLLOW_UP = /\b(it|its|that|this|those|these|they|them|there|same|also|else|what about|how about)\b/i;

interface Candidate {
  sourceIndex: number;
  /** Position of the sentence inside its passage. */
  position: number;
  sentence: string;
  terms: Set<string>;
  coverage: number;
}

export interface OfflineAnswerOptions {
  /** Minimum share of (idf-weighted) question terms the best sentence must cover, otherwise abstain. */
  minCoverage?: number;
  /** Supporting sentences from other passages, listed after the lead. */
  maxSupporting?: number;
}

const asSentence = (s: string) => s.replace(/[\s.:;,]*$/, ".");

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.max(1, a.size + b.size - inter);
}

/**
 * Deterministic extractive answerer used when no API key is configured.
 *
 * Every sentence of every retrieved passage is scored by idf-weighted overlap
 * with the question (heading terms count at half weight). The answer is then
 * stitched from verbatim sentences, each with its citation:
 *
 *  1. a lead: the best sentence, plus the sentence that follows it in the same
 *     passage when it stays on topic (definitions often span two sentences);
 *  2. up to two supporting sentences from *other* passages that clear the
 *     answer threshold and score within 75% of the lead, skipping
 *     near-duplicates. (The 75% bound comes from the eval: 60% added
 *     loosely related sentences and dropped citation precision to 84%.)
 *
 * If nothing covers enough of the question it abstains. It cannot reason or
 * paraphrase, but it exercises the exact same contract as the LLM: streaming,
 * markdown, inline [n] citations and explicit "I don't know".
 */
export function extractiveAnswer(question: string, sources: SourcePassage[], options: OfflineAnswerOptions = {}): string {
  const { minCoverage = 0.5, maxSupporting = 2 } = options;
  const qTerms = [...new Set(contentTerms(question).filter((t) => !QUESTION_NOISE.has(t)))];
  if (qTerms.length === 0 || sources.length === 0) return ABSTAIN_ANSWER;

  const sentencesBySource = sources.map((s) =>
    s.content
      .split(/\n+/)
      .flatMap((line) => splitSentences(line.replace(/^•\s*/, "")))
      .filter((sentence) => sentence.split(/\s+/).length >= 4),
  );
  const allSentences = sentencesBySource.flat();
  const df = new Map<string, number>();
  for (const sentence of allSentences) {
    for (const term of new Set(contentTerms(sentence))) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const idf = (t: string) => Math.log(1 + (allSentences.length + 1) / ((df.get(t) ?? 0) + 1));
  const totalWeight = qTerms.reduce((n, t) => n + idf(t), 0);

  const candidates: Candidate[] = [];
  sources.forEach((source, i) => {
    const headingTerms = new Set(contentTerms(`Ordenanza ${source.ordinanceNumber} ${source.headingPath} ${source.label ?? ""}`));
    sentencesBySource[i].forEach((sentence, position) => {
      const terms = new Set(contentTerms(sentence));
      let weight = 0;
      for (const t of qTerms) {
        if (terms.has(t)) weight += idf(t);
        else if (headingTerms.has(t)) weight += idf(t) * 0.5;
      }
      candidates.push({ sourceIndex: source.index, position, sentence, terms, coverage: weight / totalWeight });
    });
  });

  const ranked = [...candidates].sort(
    (a, b) => b.coverage - a.coverage || a.sourceIndex - b.sourceIndex || a.position - b.position,
  );
  const best = ranked[0];
  if (!best || best.coverage < minCoverage) return ABSTAIN_ANSWER;

  const used: Candidate[] = [best];
  const lead = [`${asSentence(best.sentence)} [${best.sourceIndex}]`];

  const next = candidates.find((c) => c.sourceIndex === best.sourceIndex && c.position === best.position + 1);
  const sharesTopic = next && [...next.terms].some((t) => best.terms.has(t) || qTerms.includes(t));
  if (next && sharesTopic && next.coverage >= 0.2) {
    lead.push(`${asSentence(next.sentence)} [${next.sourceIndex}]`);
    used.push(next);
  }

  const supporting: Candidate[] = [];
  for (const c of ranked) {
    if (supporting.length >= maxSupporting) break;
    if (c.coverage < Math.max(minCoverage, best.coverage * 0.75)) break;
    if (c.sourceIndex === best.sourceIndex) continue;
    if ([...used, ...supporting].some((u) => jaccard(u.terms, c.terms) > 0.6)) continue;
    supporting.push(c);
  }

  let answer = lead.join(" ");
  if (supporting.length === 1) {
    answer += `\n\n${asSentence(supporting[0].sentence)} [${supporting[0].sourceIndex}]`;
  } else if (supporting.length > 1) {
    answer += `\n\n**Related details**\n\n${supporting.map((c) => `- ${asSentence(c.sentence)} [${c.sourceIndex}]`).join("\n")}`;
  }
  return answer;
}

/** Offline follow-up resolution: borrow the previous question's terms when the new one leans on it. */
export function offlineStandaloneQuery(question: string, history?: HistoryTurn[]): string {
  const previous = history?.at(-1)?.question;
  const q = question.trim();
  if (!previous) return q;
  const isFollowUp = FOLLOW_UP.test(q) || contentTerms(q).length <= 3;
  return isFollowUp ? `${previous} ${q}` : q;
}

export class OfflineLlmProvider implements LlmProvider {
  readonly name = "offline" as const;
  readonly answerModel = "offline-extractive-v2";

  constructor(private readonly options: OfflineAnswerOptions = {}) {}

  async rewriteQuery(question: string, history?: HistoryTurn[]) {
    return { query: offlineStandaloneQuery(question, history), usage: null };
  }

  async streamAnswer(request: AnswerRequest, onDelta: (text: string) => void): Promise<AnswerResult> {
    const question = offlineStandaloneQuery(request.question, request.history);
    const text = extractiveAnswer(question, request.sources, this.options);
    // Stream word by word so the UI path is identical to the real provider.
    for (const piece of text.match(/\S+\s*/g) ?? []) {
      if (request.signal?.aborted) break;
      onDelta(piece);
      await new Promise((r) => setTimeout(r, 12));
    }
    return { text, usage: null, refused: false };
  }
}
