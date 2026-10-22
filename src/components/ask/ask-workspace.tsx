"use client";

import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  BookOpenCheck,
  Check,
  CircleSlash,
  Clock,
  Copy,
  History,
  Landmark,
  Loader2,
  RotateCcw,
  SquarePen,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SourceView } from "@/lib/ask-events";
import { answerForClipboard } from "@/lib/citations";
import { cn, formatMs } from "@/lib/utils";
import { AnswerMarkdown } from "./answer-markdown";
import { PipelineView } from "./pipeline-view";
import { SourceCard } from "./source-card";
import { SourcePanel } from "./source-panel";
import { type Turn, useAsk } from "./use-ask";

export interface Suggestion {
  question: string;
  topic: string;
}

const FEATURES = [
  {
    icon: BookOpenCheck,
    title: "El artículo exacto",
    body: "Cada afirmación lleva su cita. Tocala y ves el artículo, con link al texto oficial del Concejo.",
  },
  {
    icon: History,
    title: "Con la vigencia a la vista",
    body: "Si una ordenanza fue derogada o modificada después del texto publicado, te lo dice.",
  },
  {
    icon: Landmark,
    title: "Solo fuentes oficiales",
    body: "Responde únicamente con el digesto del Concejo Deliberante. Si no está, dice que no lo encontró.",
  },
];

interface Selection {
  turnId: string;
  index: number;
  claim: string | null;
}

const ease = [0.2, 0.8, 0.2, 1] as const;

export function AskWorkspace({ stats, suggestions }: { stats?: ReactNode; suggestions: Suggestion[] }) {
  const { turns, ask, regenerate, reset, busy } = useAsk();
  const [selection, setSelection] = useState<Selection | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const last = turns.at(-1);
  const progressKey = `${turns.length}:${last?.answer.length ?? 0}:${last?.sources.length ?? 0}`;
  useEffect(() => {
    if (turns.length) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [progressKey, turns.length]);

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 3 || busy) return false;
    setSelection(null);
    ask(trimmed);
    return true;
  };

  const selectedTurn = selection ? turns.find((t) => t.id === selection.turnId) : undefined;
  const selectedSource = selectedTurn?.sources.find((s) => s.index === selection?.index);
  const maxFused = Math.max(...(selectedTurn?.sources.map((s) => s.fusedScore) ?? [0]));

  if (turns.length === 0) {
    return <Hero onSubmit={submit} stats={stats} suggestions={suggestions} />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {turns.length} {turns.length === 1 ? "pregunta" : "preguntas"} · podés repreguntar sobre lo mismo
        </p>
        <Button variant="ghost" size="sm" onClick={reset}>
          <SquarePen /> Nueva consulta
        </Button>
      </div>

      <ol className="space-y-10 pb-44">
        {turns.map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            activeIndex={selection?.turnId === turn.id ? selection.index : null}
            onCite={(index, claim) => setSelection({ turnId: turn.id, index, claim })}
            onRegenerate={() => regenerate(turn.id)}
            busy={busy}
          />
        ))}
      </ol>
      <div ref={bottomRef} />

      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-background via-background/90 to-transparent px-4 pb-5 pt-10">
        <div className="mx-auto max-w-3xl">
          <Composer onSubmit={submit} busy={busy} placeholder="Repreguntá o consultá otra cosa…" />
        </div>
      </div>

      <AnimatePresence>
        {selectedSource && selectedTurn && (
          <SourcePanel
            key={`${selectedTurn.id}-${selectedSource.index}`}
            source={selectedSource}
            claim={selection?.claim ?? null}
            maxFused={maxFused}
            onClose={() => setSelection(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Hero({ onSubmit, stats, suggestions }: { onSubmit: (q: string) => boolean; stats?: ReactNode; suggestions: Suggestion[] }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center pt-4 text-center sm:pt-10">
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease }}
        className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card-solid/70 px-3 py-1 text-xs text-muted-foreground"
      >
        <span className="size-1.5 rounded-full bg-success" /> Mar del Plata y Batán · digesto del Concejo Deliberante
      </motion.p>
      <motion.h1
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.05, ease }}
        className="text-balance font-serif text-[2.9rem] font-normal leading-[1.02] tracking-[-0.015em] sm:text-[4.4rem]"
      >
        Preguntale a las ordenanzas
        <br />
        <span className="italic text-primary">de Mar del Plata.</span>
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.12, ease }}
        className="mt-6 max-w-xl text-pretty text-[15.5px] leading-relaxed text-muted-foreground"
      >
        Escribí tu duda como se la contarías a alguien. Te respondo con el artículo exacto de la ordenanza, el link al texto
        oficial y un aviso si la norma fue modificada o derogada.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, delay: 0.2, ease }}
        className="mt-9 w-full"
      >
        <Composer onSubmit={onSubmit} busy={false} autoFocus size="lg" placeholder="Por ejemplo: ¿necesito habilitación para vender comida desde mi casa?" />
      </motion.div>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {suggestions.map((s, i) => (
          <motion.button
            key={s.question}
            type="button"
            data-testid="suggestion"
            onClick={() => onSubmit(s.question)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.3 + i * 0.05, ease }}
            title={s.question}
            className="surface surface-interactive group inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] text-foreground/85"
          >
            {s.question}
            <ArrowRight className="size-3 -translate-x-0.5 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
          </motion.button>
        ))}
      </div>

      {stats && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.55, ease }}
          className="mt-12 w-full"
        >
          {stats}
        </motion.div>
      )}

      <div className="mt-4 grid w-full gap-3 text-left sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }, i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.65 + i * 0.07, ease }}
            className="surface p-4"
          >
            <span className="mb-3 grid size-8 place-items-center rounded-lg bg-primary/12 text-primary ring-1 ring-primary/20">
              <Icon className="size-4" />
            </span>
            <p className="font-display text-sm font-semibold">{title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function Composer({
  onSubmit,
  busy,
  placeholder,
  autoFocus,
  size = "default",
}: {
  onSubmit: (q: string) => boolean;
  busy: boolean;
  placeholder: string;
  autoFocus?: boolean;
  size?: "default" | "lg";
}) {
  const [value, setValue] = useState("");
  const send = () => {
    if (onSubmit(value)) setValue("");
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className={cn(
        "surface group relative flex items-end gap-2 rounded-2xl p-2 text-left transition-shadow duration-300 focus-within:shadow-[var(--shadow-elevated),var(--shadow-glow)]",
        size === "lg" && "p-2.5",
      )}
    >
      <textarea
        aria-label="Tu pregunta"
        placeholder={placeholder}
        value={value}
        rows={1}
        maxLength={600}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        className={cn(
          "field-sizing-content max-h-40 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-muted-foreground/75",
          size === "lg" && "min-h-12 py-3 text-base",
        )}
      />
      <span className="mb-2.5 hidden select-none font-mono text-[10px] text-muted-foreground/70 sm:block">⏎ preguntar</span>
      <Button type="submit" size="icon" disabled={busy || value.trim().length < 3} aria-label="Preguntar" className={cn(size === "lg" && "size-11")}>
        {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
      </Button>
    </form>
  );
}

/**
 * Ordinances behind the cited sources whose text may not be the one in force:
 * repealed, or amended after the text that was published.
 */
function vigenciaNotes(sources: SourceView[], cited: Set<number>) {
  const byNumber = new Map<number, SourceView>();
  for (const s of sources) if (cited.has(s.index) && !byNumber.has(s.ordinanceNumber)) byNumber.set(s.ordinanceNumber, s);
  return [...byNumber.values()].filter((s) => !s.inForce || s.laterAmendments.length > 0);
}

function VigenciaNote({ sources }: { sources: SourceView[] }) {
  if (!sources.length) return null;
  return (
    <div className="flex gap-3 border-t border-warning/30 bg-warning/8 px-5 py-3.5 text-[13px] leading-relaxed" data-testid="vigencia">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="space-y-1">
        <p className="font-medium">Ojo con la vigencia</p>
        {sources.map((s) =>
          !s.inForce ? (
            <p key={s.ordinanceNumber} className="text-foreground/80">
              La <OrdLink n={s.ordinanceNumber} /> no está vigente
              {s.repealedBy ? (
                <>
                  : la abrogó la <OrdLink n={s.repealedBy} />
                </>
              ) : null}
              .
            </p>
          ) : (
            <p key={s.ordinanceNumber} className="text-foreground/80">
              La <OrdLink n={s.ordinanceNumber} /> fue modificada después por{" "}
              {s.laterAmendments.map((n, i) => (
                <span key={n}>
                  {i > 0 && (i === s.laterAmendments.length - 1 ? " y " : ", ")}
                  la <OrdLink n={n} />
                </span>
              ))}
              {s.textSource === "actualizado"
                ? ", y el texto actualizado que publica el Concejo todavía no lo incorpora."
                : ". Lo citado es el texto original, así que puede haber cambiado."}
            </p>
          ),
        )}
      </div>
    </div>
  );
}

function OrdLink({ n }: { n: number }) {
  return (
    <Link href={`/ordenanza/${n}`} className="font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
      Ordenanza {n}
    </Link>
  );
}

function TurnView({
  turn,
  activeIndex,
  onCite,
  onRegenerate,
  busy,
}: {
  turn: Turn;
  activeIndex: number | null;
  onCite: (index: number, claim: string | null) => void;
  onRegenerate: () => void;
  busy: boolean;
}) {
  const cited = new Set(turn.citedIndices);
  const settled = turn.status !== "streaming";
  const notes = settled ? vigenciaNotes(turn.sources, cited) : [];
  const shown = settled && turn.answerable ? turn.sources.filter((s) => cited.has(s.index)) : turn.sources;
  const others = settled && turn.answerable ? turn.sources.filter((s) => !cited.has(s.index)) : [];

  return (
    <motion.li initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }} className="space-y-4">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[14.5px] text-primary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.18),0_8px_24px_-12px_var(--primary)]">
          {turn.question}
        </p>
      </div>

      <div className="surface overflow-hidden" data-testid="answer">
        <div className={cn("border-b border-border/60 px-5 pb-3 pt-4 transition-colors", settled && "bg-muted/25")}>
          <PipelineView stages={turn.stages} compact={settled} />
        </div>

        <div className="px-6 py-5">
          {turn.status === "error" ? (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4" /> {turn.error}
            </p>
          ) : turn.answer === "" ? (
            <div className="space-y-2.5 py-1">
              <div className="shimmer h-3 w-11/12 rounded" />
              <div className="shimmer h-3 w-9/12 rounded" />
              <div className="shimmer h-3 w-10/12 rounded" />
            </div>
          ) : (
            <AnswerMarkdown
              text={turn.answer}
              sources={turn.sources}
              streaming={turn.status === "streaming"}
              activeIndex={activeIndex}
              onCite={onCite}
            />
          )}
        </div>

        <VigenciaNote sources={notes} />

        {settled && turn.status !== "error" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
            {turn.answerable === false && (
              <Badge variant="warning">
                <CircleSlash /> No está en el digesto
              </Badge>
            )}
            {turn.answerable && turn.citedIndices.length > 0 && (
              <Badge variant="success">
                <Check /> {turn.citedIndices.length} {turn.citedIndices.length === 1 ? "fuente citada" : "fuentes citadas"}
              </Badge>
            )}
            {turn.timings && (
              <span className="inline-flex items-center gap-1" title={`búsqueda ${formatMs(turn.timings.retrievalMs)} · primera palabra ${formatMs(turn.timings.ttftMs)}`}>
                <Clock className="size-3" /> {formatMs(turn.timings.totalMs)}
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <CopyButton text={answerForClipboard(turn.answer, turn.sources, turn.citedIndices)} />
              <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={busy} aria-label="Volver a responder">
                <RotateCcw /> Reintentar
              </Button>
            </span>
          </div>
        )}
      </div>

      {shown.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {shown.map((source, i) => (
            <SourceCard
              key={source.chunkId}
              source={source}
              order={i}
              cited={cited.has(source.index)}
              active={activeIndex === source.index}
              onOpen={() => onCite(source.index, null)}
            />
          ))}
        </div>
      )}

      {others.length > 0 && (
        <details className="group text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none list-none hover:text-foreground">
            <span className="group-open:hidden">Ver {others.length} fragmentos más que se consultaron y no se citaron</span>
            <span className="hidden group-open:inline">Ocultar fragmentos no citados</span>
          </summary>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {others.map((source, i) => (
              <SourceCard
                key={source.chunkId}
                source={source}
                order={i}
                cited={false}
                active={activeIndex === source.index}
                onOpen={() => onCite(source.index, null)}
              />
            ))}
          </div>
        </details>
      )}
    </motion.li>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Copiar respuesta"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? "Copiada" : "Copiar"}
    </Button>
  );
}
