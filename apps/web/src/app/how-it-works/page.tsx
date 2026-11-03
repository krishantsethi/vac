import { PublicShell } from "@/components/layout/public-shell";
import { PageHeading, Section, Prose } from "@/components/public/page-content";
import { WorkflowExplorer } from "./workflow-explorer";
import { StatusTable } from "./status-table";

export const metadata = { title: "How it works — VAXBRIDGE AI" };

export default function HowItWorksPage() {
  return (
    <PublicShell>
      <PageHeading
        eyebrow="How it works"
        title="From uncertain records to verified outcomes"
        lede="Five stages, each one auditable. Nothing is marked as administered because a recommendation was generated — a verified record only appears after a human confirms it."
      />

      <Section title="The closed loop">
        <Prose>
          Select a stage to see what it reads, what it decides, and what it is explicitly not allowed to do. On small
          screens the workflow stacks vertically in the same order.
        </Prose>
        <WorkflowExplorer />
      </Section>

      <Section title="The status vocabulary">
        <Prose>
          Every evaluation produces one of these neutral, understandable labels. Color is never the only signal: each
          status carries a text label and an icon.
        </Prose>
        <StatusTable />
      </Section>

      <Section title="What the scheduling engine guarantees">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            ["Versioned rules", "Each ruleset records source name, source version, effective date, applicable population, rule identifiers, required fields, validation tests, and approval status."],
            ["Deterministic evaluation", "The same verified history and the same ruleset version always produce the same status. No model sampling is involved."],
            ["Recorded provenance", "Every recommendation stores which schedule version produced it, so a later ruleset change never silently rewrites history."],
            ["Recalculation on change", "Statuses are recomputed when verified information changes or when an applicable ruleset is updated."],
            ["Explicit data-quality states", "Incomplete, conflicting, and duplicate-candidate records are surfaced as their own states rather than being folded into 'overdue'."],
            ["No invented facts", "A missing entry yields insufficient information or verification required — never a fabricated dose, date, or vaccine name."],
          ].map(([h, b]) => (
            <div key={h} className="rounded-lg border border-border bg-surface/50 p-5">
              <h3 className="text-sm font-semibold text-text">{h}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-text-secondary/80">{b}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Honest limits of the demonstration">
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-5">
          <ul className="space-y-2 text-sm leading-relaxed text-amber-200/85">
            <li>• The bundled ruleset is a small, manually validated sample labeled as limited. It is not comprehensive clinical guidance for any country, programme, or age group.</li>
            <li>• OCR runs in a clearly labeled demonstration mode using prepared fixtures. No live OCR engine is connected, and no confidence figure is presented as a calibrated probability.</li>
            <li>• Priority scores are operational triage weights, documented and configurable. They are not medical-risk predictions.</li>
            <li>• Geographic and coverage figures are synthetic and aggregated. Percentage of registered patients with complete records is not population vaccination coverage.</li>
          </ul>
        </div>
      </Section>
    </PublicShell>
  );
}
