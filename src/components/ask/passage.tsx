import { bestSupportingRange } from "@/lib/highlight";

interface Props {
  content: string;
  claim: string | null;
  className?: string;
  /** When set, trim the passage to this many characters of context around the highlight. */
  context?: number;
}

/** A passage with the sentence supporting `claim` wrapped in <mark>. */
export function HighlightedPassage({ content, claim, className, context }: Props) {
  const range = claim ? bestSupportingRange(content, claim) : null;
  if (!range) {
    const text = context && content.length > context * 2 ? `${content.slice(0, context * 2).trimEnd()}…` : content;
    return <p className={className}>{text}</p>;
  }
  let from = 0;
  let to = content.length;
  if (context) {
    from = Math.max(0, range.start - context);
    to = Math.min(content.length, range.end + context);
    // snap to whitespace so words are not cut
    if (from > 0) from = content.indexOf(" ", from) + 1 || from;
    if (to < content.length) to = content.lastIndexOf(" ", to) > range.end ? content.lastIndexOf(" ", to) : to;
  }
  return (
    <p className={className}>
      {from > 0 && "… "}
      {content.slice(from, range.start)}
      <mark className="cite-mark">{content.slice(range.start, range.end)}</mark>
      {content.slice(range.end, to)}
      {to < content.length && " …"}
    </p>
  );
}
