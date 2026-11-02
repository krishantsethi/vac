"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Route-level error boundary.
 *
 * Without this, a runtime error in any client component unmounts the React tree
 * and leaves a page that renders but no longer responds to navigation — which
 * looks exactly like "clicking does nothing". Recovery is offered instead.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced in the console with its digest so a failure can be traced.
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-navy px-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
          <div className="space-y-2">
            <h1 className="font-display text-lg font-bold text-text">This view failed to load</h1>
            <p className="text-sm leading-relaxed text-text-secondary">
              Something threw while rendering this page. Your data is unaffected — this is a
              rendering failure, not a lost record.
            </p>
            {error.digest && (
              <p className="font-mono text-xs text-text-secondary/70">reference: {error.digest}</p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={reset}
                className="rounded-md bg-cyan px-4 py-2 text-sm font-semibold text-navy hover:shadow-[0_0_20px_rgba(56,217,255,0.4)]"
              >
                Try again
              </button>
              <a
                href="/app"
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text hover:border-cyan/40 hover:text-cyan"
              >
                Back to dashboard
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
