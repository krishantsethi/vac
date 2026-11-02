"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-border text-text-secondary bg-surface",
        verified: "border-mint/20 text-mint bg-mint/10",
        pending: "border-cyan/20 text-cyan bg-cyan/10",
        overdue: "border-amber-500/20 text-amber-400 bg-amber-500/10",
        conflict: "border-red-500/20 text-red-400 bg-red-500/10",
        insufficient: "border-slate-500/20 text-slate-400 bg-slate-500/10",
        success: "border-emerald-500/20 text-emerald-400 bg-emerald-500/10",
        warn: "border-amber-500/20 text-amber-400 bg-amber-500/10",
        critical: "border-red-500/20 text-red-400 bg-red-500/10",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
