"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const STAGES = [
  {
    key: "discover",
    step: "1",
    title: "Discover",
    tagline: "Compare verified history against the selected ruleset.",
    reads: ["Patient date of birth and identifiers", "Verified vaccination events only", "The active, approved schedule version"],
    decides: ["Which rules apply to this patient's age", "Which required doses have no verified event", "Where data quality itself is the problem"],
    never: [
      "Never treats an absent record as proof a dose was not given",
      "Never evaluates unverified entries as if they were confirmed",
    ],
    glyph: (
      <svg viewBox="0 0 64 64" className="h-16 w-16" fill="none" aria-hidden="true">
        <circle cx="28" cy="28" r="16" stroke="#38D9FF" strokeWidth="2" opacity="0.7" />
        <path d="M40 40l14 14" stroke="#38D9FF" strokeWidth="3" strokeLinecap="round" />
        <path d="M21 28h14M28 21v14" stroke="#57E6B1" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
      </svg>
    ),
  },
  {
    key: "classify",
    step: "2",
    title: "Classify",
    tagline: "Assign one explicit state, supported by a named rule.",
    reads: ["Dose counts per vaccine from verified events", "Rule age windows and recommended intervals", "Presence of conflicting or duplicate candidates"],
    decides: ["One status from a fixed, documented vocabulary", "Whether the finding is a gap or a data-quality issue"],
    never: [
      "Never merges ambiguous patient identities automatically",
      "Never deletes a historical record because a duplicate is suspected",
    ],
    glyph: (
      <svg viewBox="0 0 64 64" className="h-16 w-16" fill="none" aria-hidden="true">
        <path d="M8 16h20M8 32h32M8 48h14" stroke="#38D9FF" strokeWidth="3" strokeLinecap="round" />
        <circle cx="46" cy="16" r="5" stroke="#57E6B1" strokeWidth="2" />
        <circle cx="52" cy="48" r="5" stroke="#FBBF24" strokeWidth="2" />
      </svg>
    ),
  },
  {
    key: "explain",
    step: "3",
    title: "Explain",
    tagline: "Produce a traceable reason from a structured template.",
    reads: ["The detected issue and its source data", "The applicable rule identifier", "Which fields are missing"],
    decides: ["A readable explanation of why the record needs attention", "A recommended operational action"],
    never: [
      "Never generates free-form clinical narrative as the explanation of record",
      "Never presents a score as a medical-risk prediction",
    ],
    glyph: (
      <svg viewBox="0 0 64 64" className="h-16 w-16" fill="none" aria-hidden="true">
        <rect x="10" y="10" width="44" height="34" rx="4" stroke="#38D9FF" strokeWidth="2" />
        <path d="M18 22h28M18 30h20" stroke="#57E6B1" strokeWidth="2" strokeLinecap="round" />
        <path d="M24 44l8 10 8-10" stroke="#38D9FF" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: "prioritize",
    step: "4",
    title: "Prioritize",
    tagline: "Rank cases with documented, normalized weights.",
    reads: ["Validated due-date urgency", "Degree of record uncertainty", "Previous unsuccessful follow-up", "Availability of a service opportunity"],
    decides: ["An operational priority score and the factors behind it", "Which case a worker should attempt first"],
    never: [
      "Never uses caregiver refusal or migration as a punitive factor",
      "Never hides the factors that produced a score",
    ],
    glyph: (
      <svg viewBox="0 0 64 64" className="h-16 w-16" fill="none" aria-hidden="true">
        <path d="M12 52V32M28 52V20M44 52V40" stroke="#38D9FF" strokeWidth="4" strokeLinecap="round" />
        <path d="M8 12l6 6 10-10" stroke="#57E6B1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: "resolve",
    step: "5",
    title: "Resolve",
    tagline: "Record the outcome, recalculate, and measure it.",
    reads: ["Verified information entered by an authorized worker", "Contact attempts and documented outcomes", "The prior record state and audit history"],
    decides: ["Whether the case closes, reopens, or escalates", "The recalculated schedule status and updated analytics"],
    never: [
      "Never marks a dose administered merely because a recommendation existed",
      "Never silently overwrites a conflicting vaccination record",
    ],
    glyph: (
      <svg viewBox="0 0 64 64" className="h-16 w-16" fill="none" aria-hidden="true">
        <circle cx="32" cy="32" r="22" stroke="#57E6B1" strokeWidth="2" opacity="0.6" />
        <path d="M22 33l7 7 14-15" stroke="#57E6B1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export function WorkflowExplorer() {
  const [active, setActive] = useState(0);
  const stage = STAGES[active];

  return (
    <div className="mt-6">
      {/* Horizontal selector on large screens */}
      <div className="mb-6 hidden gap-2 md:flex" role="tablist" aria-label="Workflow stages">
        {STAGES.map((s, i) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={i === active}
            aria-controls={`stage-${s.key}`}
            id={`tab-${s.key}`}
            onClick={() => setActive(i)}
            className={cn(
              "flex flex-1 items-center gap-2.5 rounded-lg border px-4 py-3 text-left transition-colors",
              i === active
                ? "border-cyan/50 bg-cyan/10 text-text"
                : "border-border bg-surface/40 text-text-secondary hover:border-cyan/30 hover:text-text"
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                i === active ? "bg-cyan text-navy" : "bg-navy-secondary text-text-secondary"
              )}
            >
              {s.step}
            </span>
            <span className="text-sm font-medium">{s.title}</span>
          </button>
        ))}
      </div>

      {/* Mobile: vertical ordered list */}
      <ol className="mb-6 space-y-2 md:hidden">
        {STAGES.map((s, i) => (
          <li key={s.key}>
            <button
              onClick={() => setActive(i)}
              aria-expanded={i === active}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
                i === active ? "border-cyan/50 bg-cyan/10" : "border-border bg-surface/40"
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  i === active ? "bg-cyan text-navy" : "bg-navy-secondary text-text-secondary"
                )}
              >
                {s.step}
              </span>
              <span className="text-sm font-medium text-text">{s.title}</span>
              <span className="ml-auto text-xs text-text-secondary/70">{i === active ? "−" : "+"}</span>
            </button>
            {i === active && <StageDetail stage={stage} />}
          </li>
        ))}
      </ol>

      {/* Detail panel (desktop) */}
      <div className="hidden md:block" id={`stage-${stage.key}`} role="tabpanel" aria-labelledby={`tab-${stage.key}`}>
        <StageDetail stage={stage} />
      </div>
    </div>
  );
}

function StageDetail({ stage }: { stage: (typeof STAGES)[number] }) {
  return (
    <div className="rounded-lg border border-border bg-surface/50 p-5 md:p-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <div className="shrink-0 rounded-lg border border-border/60 bg-navy-secondary/50 p-4">{stage.glyph}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-cyan">{stage.tagline}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Column heading="Reads" items={stage.reads} tone="text-text-secondary" />
            <Column heading="Decides" items={stage.decides} tone="text-mint" />
            <Column heading="Never" items={stage.never} tone="text-amber-300/90" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Column({ heading, items, tone }: { heading: string; items: string[]; tone: string }) {
  return (
    <div>
      <h4 className={cn("mb-2 text-[11px] font-semibold uppercase tracking-[0.14em]", tone)}>{heading}</h4>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it} className="text-xs leading-relaxed text-text-secondary/85">
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
