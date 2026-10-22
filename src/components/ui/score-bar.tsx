import { cn } from "@/lib/utils";

interface ScoreBarProps {
  label: string;
  /** 0..1 fill. */
  value: number;
  display: string;
  tone?: "primary" | "fts" | "vector" | "muted";
  className?: string;
}

const tones = {
  primary: "from-primary/60 to-primary",
  fts: "from-fts/50 to-fts",
  vector: "from-vector/50 to-vector",
  muted: "from-muted-foreground/30 to-muted-foreground/60",
};

/** Compact labelled bar used for retrieval scores and ranks. */
export function ScoreBar({ label, value, display, tone = "primary", className }: ScoreBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cn("grid grid-cols-[64px_1fr_44px] items-center gap-2 text-[11px]", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full bg-gradient-to-r transition-[width] duration-700 ease-out", tones[tone])}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-right font-mono tabular-nums text-foreground/80">{display}</span>
    </div>
  );
}
