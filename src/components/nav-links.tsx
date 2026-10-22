"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Preguntar" },
  { href: "/como-funciona", label: "Cómo funciona" },
];

export function NavLinks() {
  return <NavList pathname={usePathname()} />;
}

/** Prerendered shell before the pathname is known: same links, no active state. */
export function StaticNavLinks() {
  return <NavList pathname={null} />;
}

function NavList({ pathname }: { pathname: string | null }) {
  return (
    <nav className="flex items-center gap-0.5 text-sm">
      {links.map((link) => {
        const active = pathname !== null && (link.href === "/" ? pathname === "/" : pathname.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "relative rounded-full px-3.5 py-1.5 transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-0 rounded-full bg-muted shadow-[inset_0_1px_0_0_var(--surface-highlight),0_0_0_1px_var(--surface-border)]"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative">{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
