import { ShieldCheck, Lock, ScrollText, EyeOff, RefreshCw, KeyRound, Server, FileWarning } from "lucide-react";

const CONTROLS = [
  { icon: KeyRound, title: "Secure authentication", body: "Passwords hashed with bcrypt. Sessions carried as signed, expiring JWTs. No plaintext credential storage." },
  { icon: ShieldCheck, title: "Server-side authorization", body: "Role checks and record-level access checks enforced in the API, independent of what the interface renders." },
  { icon: Lock, title: "Protected routes", body: "Authenticated areas refuse unauthenticated and under-authorized requests at the API boundary, not only in the UI." },
  { icon: FileWarning, title: "Upload validation", body: "File type and size are validated before acceptance. Malformed or oversized uploads are rejected with a clear message." },
  { icon: EyeOff, title: "Data minimisation", body: "List endpoints omit sensitive detail. Public-health views are aggregated with small-group suppression." },
  { icon: ScrollText, title: "Auditability", body: "Create, read, update, review, and decision actions are logged with actor, entity, and time." },
  { icon: RefreshCw, title: "Idempotent sync", body: "Client-generated event identifiers make retried submissions safe against duplicate clinical records." },
  { icon: Server, title: "Environment-based secrets", body: "Keys and credentials come from the environment. Nothing secret is bundled into frontend code or committed." },
];

export function ControlsGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {CONTROLS.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.title} className="rounded-lg border border-border bg-surface/50 p-5">
            <Icon className="mb-3 h-5 w-5 text-cyan" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-text">{c.title}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-text-secondary/80">{c.body}</p>
          </div>
        );
      })}
    </div>
  );
}
