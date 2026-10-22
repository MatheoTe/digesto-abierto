"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/** Honour the OS "reduce motion" setting for every motion component. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
