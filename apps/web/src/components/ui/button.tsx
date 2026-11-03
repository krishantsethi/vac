"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger" | "outline" | "success" | "warning";
  size?: "default" | "sm" | "lg";
}

const variantClasses: Record<string, string> = {
  primary: "bg-cyan text-navy shadow-[0_0_20px_rgba(56,217,255,0.35)] hover:shadow-[0_0_35px_rgba(56,217,255,0.55)]",
  ghost: "border border-border bg-transparent text-text-secondary hover:bg-surface hover:text-cyan",
  danger: "border border-transparent text-red-400 hover:bg-red-500/10 hover:text-red-300",
  outline: "border border-border bg-transparent text-text hover:bg-surface hover:text-cyan",
  success: "border border-transparent bg-mint/10 text-mint hover:bg-mint/20",
  warning: "border border-transparent bg-amber-500/10 text-amber-400 hover:bg-amber-500/20",
};

const sizeClasses: Record<string, string> = {
  default: "h-10 px-4 py-2",
  sm: "h-9 px-3 text-xs",
  lg: "h-11 px-8 text-base",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "outline", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
