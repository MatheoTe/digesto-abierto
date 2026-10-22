import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AlertTriangle, ArrowLeft, ExternalLink, FileText } from "lucide-react";
import { StatusBadges } from "@/components/ask/status-badges";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/server/corpus/chunks";
import { getDb } from "@/server/db/client";
import type { OrdinanceRelation } from "@/server/db/schema";
import { NotFoundError } from "@/server/errors";
import { getOrdinance, knownOrdinances, type OrdinanceDetail } from "@/server/repositories";

const RELATION_GROUPS: { kinds: OrdinanceRelation["kind"][]; title: string }[] = [
  { kinds: ["modificada_por", "derogada_por", "abrogada_por"], title: "Cambios que recibió" },
  { kinds: ["modifica", "deroga", "abroga"], title: "Normas que cambió" },
  { kinds: ["otra"], title: "Otras relaciones" },
];

// Blocking on purpose: an unknown number answers a real 404, and the whole
// text arrives in the first response (shareable links, search engines).
export const instant = false;

async function load(numero: string): Promise<OrdinanceDetail | null> {
  const n = Number(numero);
  if (!Number.isInteger(n) || n < 1 || n > 99999) return null;
  try {
    return await getOrdinance(await getDb(), n);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps<"/ordenanza/[numero]">): Promise<Metadata> {
  const { numero } = await params;
  return { title: `Ordenanza ${numero}` };
}

export default async function OrdinancePage({ params }: PageProps<"/ordenanza/[numero]">) {
  await connection();
  const { numero } = await params;
  const o = await load(numero);
  if (!o) notFound();

  const linked = o.relations.map((r) => r.ordinance).filter((n): n is number => n !== null);
  const known = await knownOrdinances(await getDb(), [...new Set([...linked, ...o.laterAmendments, ...(o.repealedBy ? [o.repealedBy] : [])])]);
  const ordLink = (n: number) =>
    known.has(n) ? (
      <Link href={`/ordenanza/${n}`} className="font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
        Ordenanza {n}
      </Link>
    ) : (
      <span className="font-medium">Ordenanza {n}</span>
    );

  const dates = [
    ["Sanción", o.sanctionedOn],
    ["Promulgación", o.promulgatedOn],
    ["Publicación", o.publishedOn],
  ].filter(([, d]) => d) as [string, string][];

  return (
    <article className="mx-auto max-w-5xl">
      <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Preguntar
      </Link>

      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Ordenanza municipal · General Pueyrredon</p>
        <h1 className="font-serif text-5xl font-normal leading-none tracking-[-0.01em] sm:text-6xl">Ordenanza {o.number}</h1>
        {o.summary && <p className="max-w-3xl text-pretty text-[17px] leading-relaxed text-foreground/85">{o.summary}</p>}
        <StatusBadges source={{ ...o, kind: undefined }} showYear={false} />
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {dates.map(([label, d]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{formatDate(d)}</dd>
            </div>
          ))}
        </dl>
        {o.descriptors.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {o.descriptors.map((d) => (
              <Badge key={d} variant="outline" className="normal-case">
                {d.toLowerCase()}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {o.textUrl && (
            <a href={o.textUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              Texto {o.textSource === "actualizado" ? "actualizado" : "oficial"} en el Concejo <ExternalLink className="size-3.5" />
            </a>
          )}
          {o.textSource === "actualizado" && o.originalUrl && (
            <a href={o.originalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              Texto original <ExternalLink className="size-3.5" />
            </a>
          )}
          {o.pdfUrl && (
            <a href={o.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              PDF <ExternalLink className="size-3.5" />
            </a>
          )}
          {o.sourceId && (
            <a
              href={`https://basenormas.concejomdp.gov.ar/normas/show/normas/${o.sourceId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Ficha en la Base de Normas <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      </header>

      {(!o.inForce || o.laterAmendments.length > 0) && (
        <div className="mt-7 flex gap-3 rounded-xl border border-warning/30 bg-warning/8 px-4 py-3.5 text-[14px] leading-relaxed">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          {!o.inForce ? (
            <p>
              Esta ordenanza <strong>no está vigente</strong>
              {o.repealedBy ? <>: la abrogó la {ordLink(o.repealedBy)}</> : null}
              {o.excludedOn ? ` (excluida del digesto el ${formatDate(o.excludedOn)})` : ""}.
            </p>
          ) : (
            <p>
              Después del texto publicado, la modificó{" "}
              {o.laterAmendments.map((n, i) => (
                <span key={n}>
                  {i > 0 && (i === o.laterAmendments.length - 1 ? " y " : ", ")}
                  la {ordLink(n)}
                </span>
              ))}
              .{" "}
              {o.textSource === "actualizado"
                ? "El texto actualizado del Concejo todavía no incorpora ese cambio."
                : "Lo que sigue es el texto original: revisá esas ordenanzas para saber qué cambió."}
            </p>
          )}
        </div>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-label="Texto de la ordenanza">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <FileText className="size-4" /> {o.textSource === "actualizado" ? "Texto actualizado" : o.textSource === "original" ? "Texto original" : "Texto"}
          </h2>
          {o.chunks.length === 0 ? (
            <p className="surface p-5 text-sm text-muted-foreground">
              {o.inForce
                ? "La Biblioteca del Concejo no publica el texto completo de esta ordenanza en formato digital. Está la ficha con su contenido y sus relaciones."
                : "Como no está vigente, Digesto Abierto guarda solo su ficha."}
            </p>
          ) : (
            <ol className="space-y-2">
              {o.chunks.map((c, i) => {
                const heading = c.headingPath && c.headingPath !== o.chunks[i - 1]?.headingPath ? c.headingPath.split(" > ").join(" › ") : null;
                return (
                  <li key={c.id}>
                    {heading && <p className="mb-2 mt-6 font-display text-[13px] font-semibold uppercase tracking-wide text-foreground/70">{heading}</p>}
                    <div id={`frag-${c.id}`} className="frag rounded-xl px-4 py-3 transition-shadow">
                      <p className="texto-oficial">{c.content}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          {RELATION_GROUPS.map(({ kinds, title }) => {
            const rows = o.relations.filter((r) => kinds.includes(r.kind));
            if (!rows.length) return null;
            return (
              <section key={title}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {title} <span className="font-normal">({rows.length})</span>
                </h2>
                <ul className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1 text-[13px]">
                  {rows.map((r, i) => (
                    <li key={`${r.act}-${i}`} className="leading-snug">
                      <span className="text-muted-foreground">{r.label}: </span>
                      {r.ordinance ? ordLink(r.ordinance) : <span>{r.act.toLowerCase()}</span>}
                      {r.detail && <span className="text-muted-foreground"> · {r.detail}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Relaciones según la Base de Normas del Concejo Deliberante. El texto es a título informativo: tiene validez legal lo
            publicado en el Boletín Oficial Municipal.
          </p>
        </aside>
      </div>
    </article>
  );
}
