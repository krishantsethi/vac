"use client";

/**
 * Root-level boundary: the last resort when even the layout has failed. It must
 * render its own <html>/<body>, and it deliberately avoids any component that
 * could itself be the source of the failure.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#07111F", color: "#F4F8FC", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 460, border: "1px solid rgba(165,182,201,0.18)", borderRadius: 12, padding: 24, background: "#102238" }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>VAXBRIDGE AI could not start</h1>
            <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: "#A5B6C9" }}>
              The application hit an unrecoverable error while rendering. Reload to start a fresh
              session — nothing is lost, because all records live in the database.
            </p>
            {error?.digest && (
              <p style={{ marginTop: 8, fontFamily: "monospace", fontSize: 12, color: "#A5B6C9" }}>
                reference: {error.digest}
              </p>
            )}
            <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={reset}
                style={{ background: "#38D9FF", color: "#07111F", border: 0, borderRadius: 6, padding: "10px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{ background: "transparent", color: "#F4F8FC", border: "1px solid rgba(165,182,201,0.3)", borderRadius: 6, padding: "10px 16px", fontSize: 14, cursor: "pointer" }}
              >
                Reload page
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
