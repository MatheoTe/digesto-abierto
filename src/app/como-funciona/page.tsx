import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BookOpenCheck, Database, GitBranch, History, Scale, SearchCheck, ShieldAlert } from "lucide-react";
import { CorpusStatsSkeleton, CorpusStatsStrip } from "@/components/ask/corpus-stats";
import { EvalSummary } from "@/components/eval-summary";

export const metadata: Metadata = {
  title: "Cómo funciona",
  description: "De dónde salen los datos, cómo se arma cada respuesta y cómo se mide que esté bien.",
};

const STEPS = [
  {
    title: "Entender la pregunta",
    body: "Un modelo chico reescribe la pregunta con el vocabulario de las ordenanzas: \"food truck\" también busca \"venta ambulante\" y \"vehículo gastronómico\".",
  },
  {
    title: "Buscar de dos maneras",
    body: "Por palabras, con búsqueda de texto completo en español que ignora tildes, y por significado, con vectores. Si la pregunta nombra una ordenanza por número, se busca también adentro de esa.",
  },
  {
    title: "Combinar y ordenar",
    body: "Los dos rankings se fusionan (Reciprocal Rank Fusion) y un segundo modelo reordena los mejores candidatos según cuánto responden la pregunta.",
  },
  {
    title: "Responder citando",
    body: "Claude responde solo con esos artículos. Cada oración lleva su cita; el servidor descarta cualquier cita a un fragmento que no se le dio. Si no hay respuesta en el digesto, lo dice.",
  },
  {
    title: "Avisar la vigencia",
    body: "Cada fragmento viaja con el estado de su ordenanza: si está vigente, si el texto es el actualizado o el original, y qué modificaciones posteriores no incorpora.",
  },
];

export default function ComoFuncionaPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-14">
      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Cómo funciona</p>
        <h1 className="font-serif text-5xl font-normal leading-[1.02] tracking-[-0.01em]">
          Un digesto que se puede <span className="italic text-primary">preguntar.</span>
        </h1>
        <p className="text-pretty text-[16.5px] leading-relaxed text-foreground/85">
          Las ordenanzas de General Pueyrredon son públicas, pero están en miles de archivos sueltos, muchas modificadas varias
          veces, y para saber qué dice hoy una norma hay que seguir esa cadena a mano. Digesto Abierto la sigue por vos: busca
          en todo el digesto, responde en castellano con el artículo exacto y te avisa cuando lo que cita puede haber cambiado.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
          <Database className="size-5 text-primary" /> De dónde salen los datos
        </h2>
        <p className="leading-relaxed text-foreground/85">
          Todo viene de la{" "}
          <a href="https://basenormas.concejomdp.gov.ar" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            Base de Normas
          </a>{" "}
          y de la Biblioteca del Honorable Concejo Deliberante. Para cada ordenanza se guarda su ficha oficial (resumen, fechas,
          temas y relaciones con otras normas: qué modifica, qué deroga, quién la modificó) y su texto. Cuando la Biblioteca
          publica un <em>texto actualizado</em>, que consolida las modificaciones, se usa ese; si no, el original. El texto se
          parte por artículo, que es la unidad que se cita.
        </p>
        <Suspense fallback={<CorpusStatsSkeleton />}>
          <CorpusStatsStrip />
        </Suspense>
      </section>

      <section className="space-y-5">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
          <SearchCheck className="size-5 text-primary" /> Cómo se arma cada respuesta
        </h2>
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="surface flex gap-4 p-4">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/12 font-mono text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <div>
                <p className="font-display font-semibold">{s.title}</p>
                <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
          <History className="size-5 text-primary" /> La vigencia, que es lo difícil
        </h2>
        <p className="leading-relaxed text-foreground/85">
          Una respuesta con el texto equivocado es peor que ninguna. Por eso cada ordenanza se cruza con su ficha oficial: si
          fue abrogada no se usa como regla vigente, y si la Base de Normas registra una modificación más nueva que las que
          incorpora el texto actualizado publicado, la respuesta lo avisa y enlaza la ordenanza que la modificó. Por ejemplo, la{" "}
          <Link href="/ordenanza/4471" className="text-primary underline underline-offset-2">
            Ordenanza 4471
          </Link>{" "}
          de taxis tiene un texto actualizado que llega hasta la 23868, pero en 2026 la modificó la 27004.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
          <Scale className="size-5 text-primary" /> Cómo se mide que responda bien
        </h2>
        <p className="leading-relaxed text-foreground/85">
          Hay un set de preguntas reales con su respuesta verificada a mano contra el texto oficial, incluidas preguntas que el
          digesto no responde. Cada cambio se evalúa contra ese set: si encuentra el artículo correcto, si la respuesta cita
          bien y si se abstiene cuando corresponde. Las mismas preguntas se le hacen al mismo modelo sin el digesto, para medir
          cuánto aporta.
        </p>
        <EvalSummary />
      </section>

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
          <ShieldAlert className="size-5 text-primary" /> Límites
        </h2>
        <ul className="space-y-2 text-[15px] leading-relaxed text-foreground/85">
          <li>No es un sitio oficial ni asesoramiento legal. Tiene validez legal lo publicado en el Boletín Oficial Municipal.</li>
          <li>
            El Concejo publica el texto completo de todas las ordenanzas desde la 10.000 y de las anteriores de carácter general;
            del resto solo hay ficha.
          </li>
          <li>Por ahora incluye ordenanzas. Decretos, resoluciones y la normativa provincial y nacional quedan afuera.</li>
          <li>Las preguntas se guardan sin datos de quien pregunta, para medir costos y mejorar las respuestas.</li>
        </ul>
      </section>

      <section className="surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <BookOpenCheck className="size-8 shrink-0 text-primary" />
        <p className="flex-1 text-[14.5px] leading-relaxed">
          Código abierto bajo licencia MIT, hecho en Mar del Plata por Matheo Telesca. Cualquiera puede revisar cómo funciona,
          correrlo o sumarle normativa.
        </p>
        <a
          href="https://github.com/MatheoTe/digesto-abierto"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <GitBranch className="size-4" /> Ver el código
        </a>
      </section>
    </div>
  );
}
