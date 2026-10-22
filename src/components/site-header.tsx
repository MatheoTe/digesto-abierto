import Link from "next/link";
import { Suspense } from "react";
import { NavLinks, StaticNavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";

/** A page of the digest over the sea line. */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <span
      className={`relative grid ${className} place-items-center overflow-hidden rounded-[9px] bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_4px_14px_-6px_var(--primary)]`}
    >
      <svg viewBox="0 0 24 24" className="size-[62%]" fill="none" aria-hidden="true">
        <path d="M7 4.5h7.5L18 8v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 4.5V14M9.6 8.4h5M9.6 11.2h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M3.5 18.2c1.4 0 1.4-1.2 2.8-1.2s1.4 1.2 2.8 1.2 1.4-1.2 2.8-1.2 1.4 1.2 2.8 1.2 1.4-1.2 2.8-1.2 1.4 1.2 2.8 1.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="glass sticky top-0 z-40 border-b border-border/70">
      <div className="mx-auto flex h-15 max-w-6xl items-center gap-5 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark />
          <span className="leading-none">
            <span className="block font-display text-[16px] font-semibold tracking-tight">Digesto Abierto</span>
            <span className="hidden text-[11px] text-muted-foreground sm:block">Ordenanzas de General Pueyrredon</span>
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <Suspense fallback={<StaticNavLinks />}>
            <NavLinks />
          </Suspense>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
