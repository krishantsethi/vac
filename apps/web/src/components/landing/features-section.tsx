"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { GitCompareArrows, ScanLine, ListOrdered, WifiOff, LineChart, PackageSearch, ArrowUpRight } from "lucide-react";

const FEATURES = [
  {
    icon: GitCompareArrows,
    title: "Intelligent Gap Resolution",
    body: "A deterministic engine compares verified history against a versioned ruleset and returns an explainable status: up to date, upcoming, due, potentially overdue, verification required, or insufficient information.",
    detail: "Every status names the rule that produced it and the data it relied on. The same inputs always yield the same answer, and the schedule version used is stored with the recommendation.",
    href: "/how-it-works",
    linkLabel: "See the closed loop",
  },
  {
    icon: ScanLine,
    title: "AI-Assisted Record Reconciliation",
    body: "Upload a vaccination card, review candidate fields beside the source document, and approve or reject each one. Approved values become verified records; rejected ones leave the history untouched.",
    detail: "Runs in a clearly labeled demonstration mode when no OCR provider is configured. Confidence is shown only when the provider supplies a meaningful measure — never a heuristic dressed as calibrated probability.",
    href: "/app/record-verification",
    linkLabel: "Open record verification",
  },
  {
    icon: ListOrdered,
    title: "Explainable Outreach Prioritization",
    body: "Cases are ranked by a configurable operational score built from documented, normalized factors. Each case carries a readable explanation of why it was elevated.",
    detail: "This is operational triage, not medical-risk prediction. Caregiver refusal and migration are recorded as context and never used as punitive factors.",
    href: "/app/outreach",
    linkLabel: "Open the outreach queue",
  },
  {
    icon: WifiOff,
    title: "Offline-First Field Workflows",
    body: "Work continues without connectivity. Events are saved locally with stable identifiers, then synchronized when the network returns — with explicit states for pending, syncing, synchronized, and conflict.",
    detail: "Server-side submission is idempotent, so a retry after an interruption cannot duplicate a clinical record. Conflicting updates route to human review instead of overwriting silently.",
    href: "/app/worker",
    linkLabel: "Open the worker area",
  },
  {
    icon: LineChart,
    title: "Follow-Up Outcome Analytics",
    body: "Measure what the loop actually achieved: resolution rate, open versus resolved cases, verification backlog, and event volume over a stated observation period.",
    detail: "Figures derive from the demonstration database or explicitly labeled sample data — never hardcoded inconsistently across pages, and never presented as real public-health statistics.",
    href: "/app/analytics",
    linkLabel: "Open analytics",
  },
  {
    icon: PackageSearch,
    title: "Vaccine Inventory Intelligence",
    body: "A transaction-based ledger tracks receipts, usage, and adjustments per batch, with expiry monitoring and low-stock warnings across facilities.",
    detail: "Expected demand is compared against recorded usable stock and any mismatch is labeled a projected shortage requiring verification — not a confirmed stock-out.",
    href: "/app/inventory",
    linkLabel: "Open inventory",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-20 border-y border-border/40 bg-navy-secondary/40 px-6 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-3xl">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan">Core innovations</p>
          <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-text md:text-4xl">
            Six capabilities that form one closed loop.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-text-secondary">
            Each card links to the working module it describes, so the claim can be checked rather than taken on faith.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <motion.article
                key={f.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.45, delay: (i % 3) * 0.08 }}
                className="group flex flex-col rounded-lg border border-border bg-surface/50 p-6 transition-colors hover:border-cyan/35"
              >
                <div className="mb-4 inline-flex w-fit rounded-md border border-border/70 bg-navy-secondary/60 p-2.5 text-cyan transition-colors group-hover:border-cyan/40">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-text">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary/85">{f.body}</p>
                <p className="mt-3 border-t border-border/50 pt-3 text-xs leading-relaxed text-text-secondary/65">
                  {f.detail}
                </p>
                <Link
                  href={f.href}
                  className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-cyan transition-colors hover:text-ice"
                >
                  {f.linkLabel}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </motion.article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
