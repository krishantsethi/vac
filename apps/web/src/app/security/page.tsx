import { PublicShell } from "@/components/layout/public-shell";
import { PageHeading, Section, Prose } from "@/components/public/page-content";
import { ControlsGrid } from "./controls-grid";

export const metadata = { title: "Security — VAXBRIDGE AI" };

export default function SecurityPage() {
  return (
    <PublicShell>
      <PageHeading
        eyebrow="Security"
        title="Controls implemented in this prototype"
        lede="A factual account of what is built, what is configurable, and what remains unestablished. No certification or regulatory compliance is claimed."
      />

      <Section title="Implemented controls">
        <ControlsGrid />
      </Section>

      <Section title="Authorization model">
        <Prose>
          Six roles exist — system administrator, clinic administrator, public-health administrator, healthcare worker,
          patient, and caregiver. Every protected endpoint declares the roles permitted to call it, and record-level
          access is checked separately from route-level access. A worker who can list assigned cases still cannot read a
          patient outside their scope.
        </Prose>
        <Prose>
          System administration deliberately does not imply unrestricted clinical access. Administrative capability is
          over configuration, accounts, roles, logs, and schedule versioning — not a blanket pass over every record.
          There is no shortcut account with universal read access to clinical data.
        </Prose>
      </Section>

      <Section title="Secrets and credentials">
        <Prose>
          Secrets are read from the environment. Database credentials, signing keys, and service credentials are never
          emitted into frontend code, never committed to source control, and never exposed through an API response.
          Where a third-party service is not configured — OCR today — the integration interface exists and reports its
          own status honestly rather than simulating a successful call to a provider that is not connected.
        </Prose>
      </Section>

      <Section title="Error handling and information disclosure">
        <Prose>
          Failures return a status code and a message that is safe to display. Stack traces, connection strings, and
          internal identifiers are not returned to clients. Authorization failures are indistinguishable from
          not-found responses where revealing existence would itself leak information.
        </Prose>
      </Section>

      <Section title="Offline synchronization safeguards">
        <Prose>
          Field events are created on the client with a stable identifier and submitted idempotently, so a retried
          request after a network interruption cannot duplicate a clinical record. The server validates every submitted
          event independently, rejects unauthorized changes, detects conflicting updates, and routes conflicts for
          review. Conflicting vaccination records are never silently overwritten.
        </Prose>
      </Section>

      <Section title="Deployment expectations">
        <Prose>
          The application is HTTPS-ready and expects TLS termination at the edge in any real deployment. Secure cookie
          attributes, CSRF protection for cookie-authenticated flows, and rate limiting are configurable at the
          deployment boundary. Backup and recovery must be operated by the deploying organisation; this prototype
          includes no automated backup mechanism.
        </Prose>
      </Section>

      <Section title="Interoperability path">
        <Prose>
          A future path toward standards-based exchange is anticipated in the data model — stable UUID identifiers,
          preserved provenance, separated verified and unverified records, and versioned clinical rules. No FHIR server,
          ABDM link, or government API integration is implemented or claimed today.
        </Prose>
      </Section>

      <Section title="Honest security limitations">
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-5">
          <ul className="space-y-2 text-sm leading-relaxed text-red-200/85">
            <li>• No penetration test, third-party security audit, or formal risk assessment has been performed.</li>
            <li>• No certification is held — not HIPAA, not ISO 27001, not SOC 2, not any Indian health-data standard.</li>
            <li>• The demonstration ships with seeded accounts and a default signing key. Both must be replaced before any real deployment.</li>
            <li>• Rate limiting and CSRF protection are described and configurable, but the prototype defaults to a bearer-token flow and does not exercise a production WAF or throttling tier.</li>
            <li>• Document storage is a local private directory in this deployment, not an audited object-storage service.</li>
          </ul>
          <p className="mt-4 text-xs text-red-200/70">
            This prototype is suitable for evaluation and demonstration. It is not suitable for holding real patient
            data without the additional controls described above.
          </p>
        </div>
      </Section>
    </PublicShell>
  );
}
