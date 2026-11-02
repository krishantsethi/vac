"use client";

import Link from "next/link";
import { KeyRound, FolderLock, ScrollText, Minimize2, WifiOff, PlugZap, ArrowUpRight } from "lucide-react";

const COMMITMENTS = [
  {
    icon: KeyRound,
    title: "Role-based access",
    body: "Six roles with server-side enforcement on every request. Record-level checks run separately from route-level checks, and a hidden navigation link is never treated as protection.",
  },
  {
    icon: FolderLock,
    title: "Protected document storage",
    body: "Uploaded cards live in private storage, validated for type and size on the way in, and are never served from a public path.",
  },
  {
    icon: ScrollText,
    title: "Auditability",
    body: "Actions are logged with actor, entity, and timestamp. Corrections are stored as auditable changes, so a previous record state stays reconstructable.",
  },
  {
    icon: Minimize2,
    title: "Data minimisation",
    body: "List endpoints omit unnecessary sensitive columns, and public-health views aggregate with small-group suppression so a household cannot be re-identified from a count.",
  },
  {
    icon: WifiOff,
    title: "Offline synchronization safeguards",
    body: "Client-generated identifiers and idempotent server-side creation make retries safe. Conflicting updates route to review instead of overwriting silently.",
  },
  {
    icon: PlugZap,
    title: "A path toward standards-based exchange",
    body: "Stable UUIDs, preserved provenance, separated verified and unverified records, and versioned clinical rules leave room for FHIR-compatible exchange later. None is implemented or claimed today.",
  },
];

export function SecuritySection() {
  return (
    <section id="security" className="scroll-mt-20 px-6 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan">Security &amp; interoperability</p>
            <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-text md:text-4xl">
              Design commitments, stated honestly.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-text-secondary">
              These are the controls implemented in this prototype. No certification or regulatory compliance is claimed,
              and no independent security audit has been performed.
            </p>
          </div>
          <Link
            href="/security"
            className="group inline-flex w-fit items-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium text-text transition-colors hover:border-cyan/40 hover:text-cyan"
          >
            Read the full security page
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {COMMITMENTS.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.title}
                className="rounded-lg border border-border bg-surface/50 p-6 transition-colors hover:border-cyan/35"
              >
                <div className="mb-4 inline-flex rounded-md border border-border/70 bg-navy-secondary/60 p-2.5 text-cyan">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="text-sm font-semibold text-text">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary/80">{c.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
