import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
        <h1 className="text-4xl font-semibold tracking-[-0.03em]">{title}</h1>
        <p className="text-pretty text-[14.5px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {actions}
    </div>
  );
}
