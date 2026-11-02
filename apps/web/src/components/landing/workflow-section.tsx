"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Search, BadgeCheck, ListOrdered, PhoneCall, CircleCheck, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const STAGES = [
  {
    icon: Search,
    title: "Discover",
    short: "Compare verified history against the selected schedule ruleset.",
    detail:
      "The deterministic engine loads the active, approved schedule version, validates the patient data it needs, retrieves verified vaccination events, and identifies which required doses have no verified record. Data-quality problems surface here too.",
    points: ["Uses only verified events as evidence", "Records which schedule version produced the finding"],
  },
  {
    icon: BadgeCheck,
    title: "Verify",
    short: "Reconcile incomplete records; review extracted card fields.",
    detail:
      "Uploaded vaccination cards are processed into candidate fields. A reviewer compares the document against the extraction and approves or rejects each field. Nothing becomes a verified record without that human decision.",
    points: ["Ambiguous records escalate instead of guessing", "Conflicting dates are resolved explicitly"],
  },
  {
    icon: ListOrdered,
    title: "Prioritize",
    short: "Rank follow-up with an explainable operational score.",
    detail:
      "Priority combines validated due-date urgency, record uncertainty, previous unsuccessful follow-up, and available service opportunity. Factors are normalized, weights are documented, and every case carries a readable reason.",
    points: ["Not a medical-risk prediction", "Caregiver refusal is never a punitive factor"],
  },
  {
    icon: PhoneCall,
    title: "Act",
    short: "Assign a worker, attempt contact, document the outcome.",
    detail:
      "Authorized workers take cases from the queue, record contact attempts and outcomes, schedule follow-up, flag migration or location uncertainty, note caregiver concerns, and escalate when needed. Field work continues offline and syncs idempotently.",
    points: ["Retries cannot duplicate a clinical record", "Conflicts route to review, never last-write-wins"],
  },
  {
    icon: CircleCheck,
    title: "Resolve",
    short: "Recalculate, preserve history, measure the outcome.",
    detail:
      "Once verified information is entered, the schedule is recalculated, the case status updates, the previous record and audit history are preserved, and aggregate analytics refresh so resolution is measurable.",
    points: ["A dose is never marked given because a recommendation existed", "Cases can reopen when new evidence arrives"],
  },
];

export function WorkflowSection() {
  const [active, setActive] = useState(0);
  const stage = STAGES[active];
  const Icon = stage.icon;

  return (
    <section id="how-it-works" className="scroll-mt-20 px-6 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-3xl">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan">Signature workflow</p>
          <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-text md:text-4xl">
            From Uncertain Records to Verified Outcomes.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-text-secondary">
            A closed loop rather than a record store. Select a stage to see how it works; on mobile the workflow stacks
            vertically in the same order.
          </p>
        </div>

        {/* Stage rail */}
        <ol className="mt-12 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" role="tablist" aria-label="Workflow stages">
          {STAGES.map((s, i) => {
            const SIcon = s.icon;
            const selected = i === active;
            return (
              <li key={s.title}>
                <button
                  role="tab"
                  id={`wf-tab-${i}`}
                  aria-selected={selected}
                  aria-controls="wf-panel"
                  onClick={() => setActive(i)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-all",
                    selected
                      ? "border-cyan/50 bg-cyan/[0.08] shadow-[0_0_24px_rgba(56,217,255,0.12)]"
                      : "border-border bg-surface/40 hover:border-cyan/30"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                      selected ? "bg-cyan text-navy" : "bg-navy-secondary text-text-secondary"
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("flex items-center gap-1.5 text-sm font-semibold", selected ? "text-cyan" : "text-text")}>
                      <SIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      {s.title}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-text-secondary/75">{s.short}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Detail panel */}
        <motion.div
          id="wf-panel"
          role="tabpanel"
          aria-labelledby={`wf-tab-${active}`}
          key={stage.title}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mt-6 rounded-xl border border-border bg-surface/60 p-6 md:p-8"
        >
          <div className="flex flex-col gap-6 md:flex-row md:items-start">
            <div className="flex shrink-0 items-center gap-4 md:flex-col md:items-start">
              <div className="rounded-xl border border-cyan/25 bg-cyan/[0.07] p-4">
                <Icon className="h-8 w-8 text-cyan" aria-hidden="true" />
              </div>
              <div className="md:mt-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary/60">
                  Stage {active + 1} of {STAGES.length}
                </p>
                <h3 className="font-display text-xl font-bold text-text">{stage.title}</h3>
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-base leading-relaxed text-text-secondary">{stage.detail}</p>
              <ul className="mt-5 space-y-2">
                {stage.points.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm text-mint">
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="text-text-secondary/90">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
