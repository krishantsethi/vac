"use client";

import { Toaster, toast as sonnerToast } from "sonner";

export function Toast() {
  return (
    <Toaster
      position="bottom-right"
      theme="dark"
      richColors
      closeButton
      toastOptions={{
        style: {
          background: "#102238",
          border: "1px solid rgba(165, 182, 201, 0.18)",
          color: "#F4F8FC",
        },
      }}
    />
  );
}

export type ToastVariant = "success" | "error" | "destructive" | "info" | "warning";

/**
 * Thin wrapper so call sites can use a single `toast(message, { variant })`
 * signature instead of sonner's per-type methods.
 *
 * `destructive` is accepted as an alias for `error` because that is the
 * convention used elsewhere in this codebase's components.
 */
export function toast(message: string, opts?: { variant?: ToastVariant; description?: string }) {
  // `description` is forwarded so a call site can give a second line of context
  // (the signed-in role, the reason a save was partial) without building its own
  // markup or reaching for sonner directly and losing the shared theming.
  const options = opts?.description ? { description: opts.description } : undefined;
  switch (opts?.variant) {
    case "success":
      return sonnerToast.success(message, options);
    case "error":
    case "destructive":
      return sonnerToast.error(message, options);
    case "warning":
      return sonnerToast.warning(message, options);
    default:
      return sonnerToast.info(message, options);
  }
}
