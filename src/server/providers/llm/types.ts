import type { HistoryTurn } from "@/lib/ask-events";
import type { SourcePassage } from "../../generation/prompt";

export interface LlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AnswerRequest {
  question: string;
  sources: SourcePassage[];
  /** Earlier turns of the conversation, oldest first (for follow-up questions). */
  history?: HistoryTurn[];
  signal?: AbortSignal;
}

export interface AnswerResult {
  /** Authoritative final text (may differ from the streamed deltas if a fallback model took over). */
  text: string;
  usage: LlmUsage | null;
  /** True when the model declined (safety refusal) rather than abstaining for lack of context. */
  refused: boolean;
}

export interface LlmProvider {
  readonly name: "anthropic" | "offline";
  readonly answerModel: string;
  /** Turn the (possibly follow-up) question into a standalone search query. */
  rewriteQuery(question: string, history?: HistoryTurn[]): Promise<{ query: string; usage: LlmUsage | null }>;
  streamAnswer(request: AnswerRequest, onDelta: (text: string) => void): Promise<AnswerResult>;
}

export interface FaithfulnessVerdict {
  /** 0 = unsupported, 1 = every claim supported by the sources. */
  score: number;
  verdict: "faithful" | "partially_faithful" | "unfaithful";
  unsupportedClaims: string[];
  usage: LlmUsage;
}

export interface FaithfulnessJudge {
  readonly model: string;
  judge(input: { question: string; answer: string; sources: SourcePassage[] }): Promise<FaithfulnessVerdict>;
}
