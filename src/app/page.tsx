import { Suspense } from "react";
import { AskWorkspace, type Suggestion } from "@/components/ask/ask-workspace";
import { CorpusStatsSkeleton, CorpusStatsStrip } from "@/components/ask/corpus-stats";

/**
 * Example questions. Each one is in the eval golden set (eval/golden.json):
 * `npm run eval` checks them against the official text on every run.
 */
const SUGGESTIONS: Suggestion[] = [
  { question: "¿El taxista tiene que usar camisa gris y corbata?", topic: "taxis" },
  { question: "¿Los taxis pueden trabajar con aplicaciones como Uber?", topic: "taxis" },
  { question: "¿Se puede fumar en una plaza donde hay juegos para chicos?", topic: "tabaco" },
  { question: "¿Hasta qué hora puede quedarse un chico de 16 en un boliche?", topic: "nocturnidad" },
  { question: "¿Sigue vigente la Ordenanza 15043?", topic: "vigencia" },
];

export default function AskPage() {
  return (
    <AskWorkspace
      suggestions={SUGGESTIONS}
      stats={
        <Suspense fallback={<CorpusStatsSkeleton />}>
          <CorpusStatsStrip />
        </Suspense>
      }
    />
  );
}
