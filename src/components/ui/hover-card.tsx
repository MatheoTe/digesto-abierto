"use client";

import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const noopSubscribe = () => () => {};

interface HoverCardProps {
  trigger: ReactNode;
  children: ReactNode;
  width?: number;
  className?: string;
  /** Delay before opening, ms. */
  openDelay?: number;
}

/**
 * Lightweight hover/focus popover rendered in a portal so it is never clipped
 * by scrolling containers. Flips below the trigger when there is no room above.
 */
export function HoverCard({ trigger, children, width = 360, className, openDelay = 120 }: HoverCardProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placement: "top" | "bottom" } | null>(null);
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const place = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
    const placement = rect.top > 300 ? "top" : "bottom";
    setPos({ top: placement === "top" ? rect.top - 10 : rect.bottom + 10, left, placement });
  }, [width]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), openDelay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 80);
  };

  return (
    <span
      ref={anchorRef}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onPointerDown={() => {
        if (timer.current) clearTimeout(timer.current);
        setOpen(false);
      }}
    >
      {trigger}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <div
                key="hover-card"
                style={{
                  position: "fixed",
                  top: pos.top,
                  left: pos.left,
                  width,
                  transform: pos.placement === "top" ? "translateY(-100%)" : undefined,
                  zIndex: 60,
                }}
              >
                <motion.div
                  role="tooltip"
                  onMouseEnter={show}
                  onMouseLeave={hide}
                  initial={{ opacity: 0, y: pos.placement === "top" ? 6 : -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: pos.placement === "top" ? 4 : -4, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
                  className={cn("surface p-4 text-left text-sm", className)}
                  style={{ background: "color-mix(in oklch, var(--card-solid) 94%, transparent)" }}
                >
                  {children}
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </span>
  );
}
