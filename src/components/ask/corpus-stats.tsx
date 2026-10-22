import { BookText, CalendarClock, FileCheck2, Scale } from "lucide-react";
import { connection } from "next/server";
import { formatDate } from "@/server/corpus/chunks";
import { getDb } from "@/server/db/client";
import { getCorpusStats } from "@/server/repositories";

const n = (value: number) => value.toLocaleString("es-AR");

function Stat({ icon: Icon, value, label }: { icon: typeof Scale; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="text-left">
        <span className="block font-display text-[15px] font-semibold tabular-nums leading-tight">{value}</span>
        <span className="block text-[11px] text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

/** Live corpus summary for the empty state. */
export async function CorpusStatsStrip() {
  await connection();
  const stats = await getCorpusStats(await getDb());
  return (
    <div className="surface grid grid-cols-2 divide-border/60 sm:grid-cols-4 sm:divide-x" data-testid="corpus-stats">
      <Stat icon={Scale} value={n(stats.ordinances)} label="ordenanzas en la base" />
      <Stat icon={FileCheck2} value={n(stats.inForce)} label="vigentes" />
      <Stat icon={BookText} value={n(stats.articles)} label="artículos para citar" />
      <Stat icon={CalendarClock} value={formatDate(stats.lastSanctionedOn) ?? "—"} label="última sanción incluida" />
    </div>
  );
}

export function CorpusStatsSkeleton() {
  return <div className="surface h-[62px] animate-pulse" />;
}
