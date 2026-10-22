import summary from "../../eval/reports/summary.json";

interface Row {
  label: string;
  value: string;
  baseline?: string;
}

/**
 * Headline numbers of the latest eval run (eval/reports/summary.json, written
 * by `npm run eval -- --live`). Static import: the page shows exactly what was
 * committed with the code.
 */
export function EvalSummary() {
  const s = summary as {
    runAt: string | null;
    questions: number;
    answerable: number;
    unanswerable: number;
    retrievalRecallAt8: number | null;
    citedCorrectOrdinance: number | null;
    correctAbstentions: number | null;
    faithfulness: number | null;
    closedBook: { correctOrdinance: number | null; inventedOrdinances: number | null } | null;
  };
  if (!s.runAt) return null;
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  const rows: Row[] = [
    { label: "Encuentra el artículo correcto entre los 8 primeros", value: pct(s.retrievalRecallAt8) },
    {
      label: "Responde citando la ordenanza correcta",
      value: pct(s.citedCorrectOrdinance),
      baseline: s.closedBook ? pct(s.closedBook.correctOrdinance) : undefined,
    },
    { label: "Dice \"no lo encontré\" cuando el digesto no responde", value: pct(s.correctAbstentions) },
    { label: "Afirmaciones respaldadas por la fuente citada", value: pct(s.faithfulness) },
  ];
  return (
    <div className="surface overflow-hidden">
      <table className="w-full text-[14px]">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium">{s.questions} preguntas verificadas</th>
            <th className="px-4 py-2.5 text-right font-medium">Digesto Abierto</th>
            {s.closedBook && <th className="px-4 py-2.5 text-right font-medium">Mismo modelo sin el digesto</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="px-4 py-2.5">{r.label}</td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{r.value}</td>
              {s.closedBook && <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{r.baseline ?? ""}</td>}
            </tr>
          ))}
          {s.closedBook?.inventedOrdinances !== null && s.closedBook?.inventedOrdinances !== undefined && (
            <tr>
              <td className="px-4 py-2.5">Respuestas que nombran una ordenanza que no dice eso</td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums">—</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{pct(s.closedBook.inventedOrdinances)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
        Última medición: {new Date(s.runAt).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })} ·{" "}
        {s.answerable} preguntas con respuesta y {s.unanswerable} sin respuesta en el digesto.
      </p>
    </div>
  );
}
