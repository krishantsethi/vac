"use client";

import { motion } from "framer-motion";
import { ScanLine, BookMarked, ArrowUpCircle, MessageSquareText, Stethoscope, Ban } from "lucide-react";

const PRINCIPLES = [
  {
    icon: ScanLine,
    title: "OCR output requires appropriate verification",
    body: "Extracted fields are candidates. A human reviews them beside the source document, and only approved values become verified records. Uncertain extractions require review rather than being accepted silently.",
  },
  {
    icon: BookMarked,
    title: "Scheduling uses versioned, validated rules",
    body: "A deterministic rules engine is authoritative — never a language model. Each ruleset records its source, version, effective date, applicable population, rule identifiers, required fields, validation tests, and approval status.",
  },
  {
    icon: ArrowUpCircle,
    title: "Ambiguous records are escalated",
    body: "Conflicting dates, duplicate candidates, and uncertain identities are surfaced for review. Ambiguous patient identities are never merged automatically, and a suspected duplicate never deletes a historical record.",
  },
  {
    icon: MessageSquareText,
    title: "Recommendations include explanations",
    body: "Structured templates produce the explanation of record: the detected issue, the source data, the applicable rule identifier, what is missing, why follow-up is warranted, and the recommended operational action.",
  },
  {
    icon: Stethoscope,
    title: "Clinical decisions stay with professionals",
    body: "The platform coordinates and explains. It does not diagnose, does not prescribe, and does not decide whether a dose should be given to a particular child on a particular day.",
  },
];

export function ResponsibleAiSection() {
  return (
    <section id="responsible-ai" className="scroll-mt-20 border-y border-border/40 bg-navy-secondary/40 px-6 py-20 lg:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan">Responsible AI</p>
            <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-text md:text-4xl">
              AI Assists. Validated Rules Guide. Humans Decide.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-text-secondary">
              Machine assistance is useful precisely where records are messy — reading a card, normalizing a vaccine
              name, ranking a queue. It is dangerous where a wrong answer becomes a clinical action. The architecture
              keeps those two zones separate.
            </p>

            <div className="mt-8 rounded-lg border border-red-500/25 bg-red-500/[0.06] p-5">
              <div className="flex items-start gap-3">
                <Ban className="mt-0.5 h-5 w-5 shrink-0 text-red-400" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-red-300">What is deliberately not claimed</h3>
                  <ul className="mt-2.5 space-y-1.5 text-xs leading-relaxed text-red-200/80">
                    <li>• No fabricated clinical accuracy metrics or validated model performance.</li>
                    <li>• No heuristic score presented as calibrated probability.</li>
                    <li>• No priority score represented as a medical-risk prediction.</li>
                    <li>• No fake AI output presented as real inference.</li>
                    <li>• No claimed integration with CoWIN, U-WIN, ABDM, or any government API.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {PRINCIPLES.map((p, i) => {
              const Icon = p.icon;
              return (
                <motion.div
                  key={p.title}
                  initial={{ opacity: 0, x: 16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.45, delay: i * 0.06 }}
                  className="flex gap-4 rounded-lg border border-border bg-surface/50 p-5 transition-colors hover:border-mint/30"
                >
                  <div className="shrink-0 rounded-md border border-mint/25 bg-mint/[0.08] p-2.5 text-mint">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-text">{p.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-text-secondary/85">{p.body}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
