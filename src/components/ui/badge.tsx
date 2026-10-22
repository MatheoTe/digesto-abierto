import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap backdrop-blur-sm [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-primary/25 bg-primary/12 text-accent-foreground",
        outline: "border-border bg-muted/40 text-muted-foreground",
        success: "border-success/25 bg-success/12 text-success",
        warning: "border-warning/30 bg-warning/12 text-warning",
        destructive: "border-destructive/30 bg-destructive/12 text-destructive",
        fts: "border-fts/30 bg-fts/12 text-fts",
        vector: "border-vector/30 bg-vector/12 text-vector",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
