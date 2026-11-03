"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "block w-full rounded-md border border-border bg-navy-secondary text-text placeholder:text-text-secondary/60 text-sm focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan transition-colors disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "block w-full rounded-md border border-border bg-navy-secondary text-text placeholder:text-text-secondary/60 text-sm focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan transition-colors disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";
