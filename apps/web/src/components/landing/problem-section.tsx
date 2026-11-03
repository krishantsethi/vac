"use client";

import { motion } from "framer-motion";
import { Layers, HelpCircle, Clock3, EyeOff } from "lucide-react";

const PROBLEMS = [
  {
    icon: Layers,
    title: "Fragmented Records",
    body: "Immunization history is split across paper cards, clinic registers, and systems that never reconcile. No single view of what a child actually received.",
  },
  {
    icon: HelpCircle,
    title: "Uncertain Vaccination History",
    body: "Illegible cards, conflicting dates, and entries nobody verified leave the protection status genuinely unknown rather than confidently wrong.",
  },
  {
    icon: Clock3,
    title: "Unresolved Follow-Up",
    body: "Overdue doses and missed appointments accumulate without an explainable queue, so effort lands wherever it was noticed last.",
  },
  {
    icon: EyeOff,
    title: "Limited Operational Visibility",
    body: "Clinics and public-health teams lack aggregate, auditable views of coverage, backlog, and stock — so planning rests on guesswork.",
  },
];

export function ProblemSection() {
  return (
    <section id="problem" className="scroll-mt-20 border-y border-border/40 bg-navy-secondary/40 px-6 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-3xl">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan">The problem</p>
          <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-text md:text-4xl">
            Vaccination Gaps Are Not Always Visible.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-text-secondary">
            A missing database entry must never be treated as proof that a vaccination was not administered. Absent
            information and absent immunization are different facts with different consequences, and conflating them
            produces false overdue lists and wasted outreach.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {PROBLEMS.map((p, i) => {
            const Icon = p.icon;
            return (
              <motion.div
                key={p.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.45, delay: i * 0.07 }}
                className="group relative rounded-lg border border-border bg-surface/50 p-6 transition-colors hover:border-cyan/35"
              >
                <div className="mb-4 inline-flex rounded-md border border-border/70 bg-navy-secondary/60 p-2.5 text-cyan transition-colors group-hover:border-cyan/40">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="text-sm font-semibold text-text">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary/80">{p.body}</p>
              </motion.div>
            );
          })}
        </div>

        <div className="mt-10 rounded-lg border border-cyan/20 bg-cyan/[0.04] p-6">
          <h3 className="text-sm font-semibold text-cyan">The distinction this product is built on</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border border-border/60 bg-navy/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary/70">Genuinely missing dose</p>
              <p className="mt-1.5 text-sm leading-relaxed text-text-secondary/85">
                No verified event exists, the patient was eligible, and the recommended window has passed. This warrants
                a scheduled vaccination.
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-navy/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-secondary/70">Incomplete or uncertain record</p>
              <p className="mt-1.5 text-sm leading-relaxed text-text-secondary/85">
                A dose may well have been given, but the evidence is unverified, conflicting, or duplicated. This warrants
                record reconciliation — not an injection.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
