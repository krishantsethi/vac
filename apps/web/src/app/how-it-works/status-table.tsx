import { Badge } from "@/components/ui/badge";

const STATUSES: { label: string; variant: any; meaning: string }[] = [
  { label: "Up to date", variant: "verified", meaning: "A verified event satisfies the rule for the selected ruleset." },
  { label: "Upcoming", variant: "pending", meaning: "The patient is not yet eligible; the earliest eligible date is known." },
  { label: "Due", variant: "overdue", meaning: "Eligible now and inside the recommended window, with no verified event." },
  { label: "Potentially overdue", variant: "overdue", meaning: "The recommended window has passed without a verified event. May still be a record gap." },
  { label: "Verification required", variant: "conflict", meaning: "Unverified or conflicting entries exist for this vaccine; review before acting." },
  { label: "Insufficient information", variant: "insufficient", meaning: "Required data is missing, so eligibility cannot be determined." },
  { label: "Clinical review required", variant: "conflict", meaning: "The case needs professional judgment beyond what the ruleset can decide." },
];

export function StatusTable() {
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Vaccination status labels and their meanings</caption>
        <thead>
          <tr className="border-b border-border/60 bg-navy-secondary/50">
            <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">Status</th>
            <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">What it means</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {STATUSES.map((s) => (
            <tr key={s.label}>
              <td className="px-4 py-3 align-top">
                <Badge variant={s.variant}>{s.label}</Badge>
              </td>
              <td className="px-4 py-3 align-top text-sm leading-relaxed text-text-secondary/85">{s.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
