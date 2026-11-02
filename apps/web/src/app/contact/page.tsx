import { PublicShell } from "@/components/layout/public-shell";
import { PageHeading, Section, Prose } from "@/components/public/page-content";
import { ContactForm } from "./contact-form";

export const metadata = { title: "Contact — VAXBRIDGE AI" };

export default function ContactPage() {
  return (
    <PublicShell>
      <PageHeading
        eyebrow="Contact"
        title="Get in touch about the prototype"
        lede="Use the form below to record an enquiry. No company address, telephone number, or support mailbox is invented for this demonstration."
      />

      <Section title="Enquiry form">
        <Prose>
          This form validates your input and records the enquiry locally so you can see the workflow end to end. Because
          no email or messaging provider is configured in this prototype, the submission is not transmitted anywhere —
          the interface tells you so rather than pretending delivery succeeded.
        </Prose>
        <ContactForm />
      </Section>

      <Section title="Before you reach out">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["Evaluating the product", "Sign in with one of the demonstration accounts listed on the sign-in page to explore every role-specific view."],
            ["Reviewing the implementation", "The API exposes interactive documentation at /docs, and the source repository is linked in the footer."],
            ["Considering a real deployment", "Read the security and privacy pages first. Both state plainly which controls are implemented and which are unestablished."],
          ].map(([h, b]) => (
            <div key={h} className="rounded-lg border border-border bg-surface/50 p-5">
              <h3 className="text-sm font-semibold text-text">{h}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-text-secondary/80">{b}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Scope of this prototype">
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-5">
          <p className="text-sm leading-relaxed text-amber-200/85">
            VAXBRIDGE AI is an independent demonstration prototype. It is not affiliated with, endorsed by, or integrated
            with any government body or health authority, and it has no connection to CoWIN, U-WIN, or ABDM. Please do not
            send real patient information, real vaccination cards, or any identifiable health data through this form.
          </p>
        </div>
      </Section>
    </PublicShell>
  );
}
