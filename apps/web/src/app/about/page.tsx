import { PublicShell } from "@/components/layout/public-shell";
import { PageHeading, Section, Prose } from "@/components/public/page-content";

export const metadata = { title: "About — VAXBRIDGE AI" };

export default function AboutPage() {
  return <PageContent />;
}

function PageContent() {
  return (
    <PublicShell>
      <PageHeading
        eyebrow="About"
        title="A coordination layer for immunization records"
        lede="VAXBRIDGE AI exists to close the distance between a fragmented vaccination record and a concrete next action for a healthcare team."
      />
      <Section title="The problem we designed for">
        <Prose>
          Immunization history is rarely held in one place. Doses are recorded on paper cards, in clinic registers, and
          across systems that do not talk to each other. When a record is incomplete, the operational consequence is
          uncertainty: a health worker cannot tell whether a child missed a dose or simply attended a facility whose
          records never arrived.
        </Prose>
        <Prose>
          That distinction matters. Treating an absent database row as proof that a vaccine was never administered
          produces false overdue lists, wasted outreach effort, and eroded trust with caregivers. VAXBRIDGE AI is built
          around the principle that <strong className="text-text">a missing entry is a question, not an answer</strong>.
        </Prose>
      </Section>
      <Section title="What the platform does">
        <Prose>
          The product is a closed loop rather than a record store. It discovers potential gaps by comparing verified
          history against a versioned schedule ruleset, classifies each finding into an explicit state, attaches a
          traceable explanation naming the rule that produced it, prioritizes follow-up with an explainable operational
          score, lets an authorized worker record the outcome, and then recalculates so the resolution is measurable.
        </Prose>
      </Section>
      <Section title="What the platform is not">
        <Prose>
          VAXBRIDGE AI is not a national immunization registry and does not replace one. It has no connection to CoWIN,
          U-WIN, ABDM, or any government API, and it makes no claim of interoperability certification or regulatory
          compliance. It does not predict medical risk. It does not merge uncertain patient identities automatically.
          It does not send SMS or WhatsApp messages unless a real provider is configured and delivery succeeds.
        </Prose>
        <Prose>
          The scheduling engine is deterministic and rule-based. A language model is never the authoritative scheduler;
          at most it assists with text normalization, and it may not invent a vaccine name or a vaccination date.
        </Prose>
      </Section>
      <Section title="Who it is for" id="audiences">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            ["Patients and caregivers", "View authorized histories, upload cards, track verification requests, and see upcoming doses explained in plain language."],
            ["Healthcare workers", "Work an assigned case queue, review extracted fields, resolve conflicting dates, and record outcomes — including offline."],
            ["Clinic administrators", "Manage staff and catalogue, track batches and expiry, monitor appointments, and review facility-level metrics."],
            ["Public-health administrators", "See aggregate coverage and unresolved follow-up by service area, with small groups suppressed."],
          ].map(([h, b]) => (
            <div key={h} className="rounded-lg border border-border bg-surface/50 p-5">
              <h3 className="text-sm font-semibold text-text">{h}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-text-secondary/80">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Prototype disclaimer" id="disclaimer">
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-5">
          <p className="text-sm leading-relaxed text-amber-200/85">
            This is a demonstration prototype containing only synthetic data. Any patient names, phone numbers,
            addresses, batch numbers, and coverage figures shown are generated for evaluation purposes and describe no
            real person, facility, or population. No government endorsement, hospital partnership, patient count, or
            real-world success statistic is claimed anywhere in this product.
          </p>
        </div>
      </Section>
    </PublicShell>
  );
}
