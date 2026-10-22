"use client";

import { ArrowUpRight } from "lucide-react";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HoverCard } from "@/components/ui/hover-card";
import type { SourceView } from "@/lib/ask-events";
import { toCitationMarkdown } from "@/lib/citations";
import { cn } from "@/lib/utils";
import { HighlightedPassage } from "./passage";
import { sourceTitle } from "./source-card";
import { StatusBadges } from "./status-badges";

interface Props {
  text: string;
  sources: SourceView[];
  streaming: boolean;
  activeIndex: number | null;
  onCite: (index: number, claim: string) => void;
}

/** Markdown answer whose [n] markers render as pills with a hover preview of the cited passage. */
export function AnswerMarkdown({ text, sources, streaming, activeIndex, onCite }: Props) {
  const { markdown, claims } = useMemo(() => toCitationMarkdown(text, sources.length), [text, sources.length]);

  return (
    <div className={cn("prose-answer", streaming && "streaming-caret")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const match = href?.match(/^#cite-(\d+)-(\d+)$/);
            if (!match) {
              return (
                <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                  {children}
                </a>
              );
            }
            const index = Number(match[1]);
            const claim = claims[Number(match[2])] ?? "";
            const source = sources[index - 1];
            if (!source) return <span>[{index}]</span>;
            return <CitationPill index={index} source={source} claim={claim} active={activeIndex === index} onClick={() => onCite(index, claim)} />;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function CitationPill({
  index,
  source,
  claim,
  active,
  onClick,
}: {
  index: number;
  source: SourceView;
  claim: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <HoverCard
      width={380}
      trigger={
        <button
          type="button"
          data-testid="citation"
          onClick={onClick}
          aria-label={`Fuente ${index}: ${sourceTitle(source)}`}
          className={cn(
            "mx-[2px] inline-grid h-[18px] min-w-[18px] -translate-y-[1px] cursor-pointer place-items-center rounded-md px-1 align-middle font-mono text-[10.5px] font-semibold leading-none transition-all duration-200",
            active
              ? "bg-primary text-primary-foreground shadow-[0_0_14px_-2px_var(--primary)]"
              : "bg-primary/15 text-accent-foreground ring-1 ring-primary/30 hover:bg-primary hover:text-primary-foreground hover:shadow-[0_0_14px_-2px_var(--primary)]",
          )}
        >
          {index}
        </button>
      }
    >
      <div className="space-y-3" data-testid="citation-preview">
        <div className="flex items-start gap-2.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary font-mono text-[11px] font-semibold text-primary-foreground">
            {index}
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-[13px] font-semibold">{sourceTitle(source)}</p>
            <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{source.ordinanceSummary}</p>
          </div>
        </div>
        <HighlightedPassage
          content={source.content}
          claim={claim}
          context={220}
          className="whitespace-pre-wrap border-l-2 border-primary/50 pl-3 text-[12.5px] leading-relaxed text-foreground/85"
        />
        <div className="flex items-center justify-between gap-2">
          <StatusBadges source={source} showYear={false} />
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
            tocá para abrir <ArrowUpRight className="size-3" />
          </span>
        </div>
      </div>
    </HoverCard>
  );
}
