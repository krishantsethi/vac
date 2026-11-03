import Link from "next/link";

export function PageHeading({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede: string;
}) {
  return (
    <section className="border-b border-border/50 px-6 py-16 md:py-20">
      <div className="mx-auto max-w-4xl">
        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan">{eyebrow}</p>
        <h1 className="font-display text-3xl font-bold leading-tight tracking-tight text-text md:text-5xl">
          {title}
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-relaxed text-text-secondary md:text-lg">{lede}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/app"
            className="rounded-md bg-cyan px-4 py-2 text-sm font-semibold text-navy shadow-[0_0_20px_rgba(56,217,255,0.3)] transition-shadow hover:shadow-[0_0_30px_rgba(56,217,255,0.5)]"
          >
            Launch the dashboard
          </Link>
          <Link
            href="/how-it-works"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-cyan/40 hover:text-cyan"
          >
            See how it works
          </Link>
        </div>
      </div>
    </section>
  );
}

export function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-b border-border/40 px-6 py-12 last:border-0">
      <div className="mx-auto max-w-4xl">
        <h2 className="mb-5 font-display text-xl font-bold text-text md:text-2xl">{title}</h2>
        <div className="space-y-4">{children}</div>
      </div>
    </section>
  );
}

export function Prose({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-text-secondary md:text-base">{children}</p>;
}
