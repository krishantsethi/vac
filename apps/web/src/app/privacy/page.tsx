import { PublicShell } from "@/components/layout/public-shell";
import { PageHeading, Section, Prose } from "@/components/public/page-content";

export const metadata = { title: "Privacy — VAXBRIDGE AI" };

export default function PrivacyPage() {
  return (
    <PublicShell>
      <PageHeading
        eyebrow="Privacy"
        title="Data minimisation by design"
        lede="This page describes the privacy commitments implemented in this prototype, and states plainly what has not been established."
      />

      <Section title="What we collect, and why">
        <Prose>
          VAXBRIDGE AI stores only what a vaccination coordination workflow needs: identifiers sufficient to resolve a
          record unambiguously, vaccination events with their provenance, documents a user chooses to upload, and the
          operational trail of who did what. Fields that do not change a decision are not collected.
        </Prose>
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Data categories and their purpose</caption>
            <thead>
              <tr className="border-b border-border/60 bg-navy-secondary/50">
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">Category</th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {[
                ["Identity and demographics", "Resolve a record to one person and evaluate age-based schedule rules."],
                ["Vaccination events", "Establish verified history, which is the input to every gap calculation."],
                ["Uploaded documents", "Provide the source evidence a human reviews before a record becomes verified."],
                ["Outreach attempts and outcomes", "Make follow-up measurable and prevent repeated unsuccessful contact."],
                ["Audit events", "Attribute every change to an actor and a time, preserving a correction history."],
                ["Consent records", "Record authorization for caregiver relationships and data processing."],
              ].map(([a, b]) => (
                <tr key={a}>
                  <td className="px-4 py-3 align-top text-text">{a}</td>
                  <td className="px-4 py-3 align-top text-text-secondary/85">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Who can see what">
        <Prose>
          Access is role-scoped and enforced server-side on every request. A patient sees only their own record. A
          caregiver sees only dependents linked by an explicit, authorized relationship — an unauthorized or revoked
          link returns a refusal, not a partial view. A healthcare worker is scoped to assigned cases. Public-health
          views are aggregated, with small groups suppressed so a household cannot be re-identified from a count.
        </Prose>
        <Prose>
          Hiding a link in the interface is not treated as protection. Direct API calls are authorized independently of
          the UI, and generic list endpoints do not return unrestricted patient data.
        </Prose>
      </Section>

      <Section title="Corrections are preserved, not overwritten">
        <Prose>
          A suspected duplicate never causes a historical record to be deleted, and an ambiguous identity is never merged
          automatically. Corrections are stored as auditable changes so the previous state remains reconstructable.
          Conflicting updates discovered during offline synchronization are routed for human review rather than resolved
          by last-write-wins.
        </Prose>
      </Section>

      <Section title="Documents and verification artifacts">
        <Prose>
          Uploaded vaccination cards are stored in private storage and are not served from a public path. Uploads are
          validated for type and size before they are accepted. Digital record QR codes carry a signed, limited payload
          that resolves to a verification workflow; unrestricted personal health information is never placed in a
          scannable public code.
        </Prose>
      </Section>

      <Section title="Offline data on worker devices">
        <Prose>
          Offline caching is restricted to explicitly authorized records for the signed-in worker. Queued events carry
          stable client-generated identifiers so a retry cannot create a duplicate clinical record, and submission is
          idempotent on the server. Cached data is cleared on sign-out.
        </Prose>
      </Section>

      <Section title="Indian context">
        <Prose>
          The product is designed for Indian use: India-friendly date display, Indian phone-number
          validation and formatting, family and caregiver workflows, government and private facility
          concepts, low-connectivity operation with an on-device capture queue, and continuity for
          migrant families whose records span facilities.
        </Prose>
        <Prose>
          <strong className="font-semibold text-text">Language support is English only in this
          prototype.</strong> A per-user language preference (including Hindi) can be stored and is
          part of the account model, but the interface is not yet translated — no Hindi strings ship
          in this build. Recording the preference is groundwork, not a delivered translation.
        </Prose>
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-5">
          <p className="text-sm leading-relaxed text-amber-200/85">
            <strong className="font-semibold text-amber-300">What we do not claim.</strong> This prototype has not been
            assessed for compliance with the DPDP Act or any other privacy regulation, and no independent audit,
            certification, or legal review has been performed. Consent, retention, and breach-notification obligations
            for a real deployment must be established separately by the deploying organisation with qualified legal
            counsel. No government data-sharing arrangement exists or is implied.
          </p>
        </div>
      </Section>

      <Section title="Demonstration data">
        <Prose>
          Every person, phone number, address, batch, and coverage figure in this deployment is synthetic and generated
          from a deterministic seed so the demonstration is repeatable. No real patient information is used anywhere in
          the product, including in the 3D visualizations.
        </Prose>
      </Section>
    </PublicShell>
  );
}
