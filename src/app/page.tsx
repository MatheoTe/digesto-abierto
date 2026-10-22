import { Suspense } from "react";
import { AskWorkspace, type Suggestion } from "@/components/ask/ask-workspace";
import { CorpusStatsSkeleton, CorpusStatsStrip } from "@/components/ask/corpus-stats";

/**
 * Example questions. Each one is in the eval golden set (eval/golden.json),
 * so a change that breaks an example fails CI before it reaches the home page.
 */
const SUGGESTIONS: Suggestion[] = [
  { question: "¿Cuántas horas por día tiene que trabajar un taxi?", topic: "taxis" },
  { question: "¿Qué necesito para habilitar un food truck?", topic: "venta ambulante" },
  { question: "¿Se puede fumar en un bar?", topic: "tabaco" },
  { question: "¿Qué pasa si no junto la caca de mi perro?", topic: "mascotas" },
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
