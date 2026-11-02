"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Syringe, X } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Product", href: "/#features" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Security", href: "/security" },
  { label: "Privacy", href: "/privacy" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export function PublicHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled || pathname !== "/"
          ? "border-b border-border bg-navy/90 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <Syringe className="h-5 w-5 text-cyan" aria-hidden="true" />
          <span className="font-display text-lg font-bold tracking-tight text-text">
            VAXBRIDGE<span className="text-cyan"> AI</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className="text-sm font-medium text-text-secondary transition-colors hover:text-cyan"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/login"
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:border-cyan/40 hover:text-cyan"
          >
            Sign in
          </Link>
          <Link
            href="/app"
            className="rounded-md bg-cyan px-3 py-1.5 text-sm font-semibold text-navy shadow-[0_0_20px_rgba(56,217,255,0.35)] transition-shadow hover:shadow-[0_0_30px_rgba(56,217,255,0.55)]"
          >
            Launch Dashboard
          </Link>
        </div>

        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-md p-2 text-text-secondary hover:text-cyan md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <nav
          className="border-t border-border bg-navy/95 px-6 py-4 backdrop-blur-md md:hidden"
          aria-label="Mobile"
        >
          <div className="flex flex-col gap-1">
            {NAV.map((n) => (
              <Link
                key={n.label}
                href={n.href}
                className="rounded-md px-3 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface hover:text-cyan"
              >
                {n.label}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3">
              <Link
                href="/login"
                className="rounded-md border border-border px-3 py-2.5 text-center text-sm font-medium text-text-secondary hover:text-cyan"
              >
                Sign in
              </Link>
              <Link
                href="/app"
                className="rounded-md bg-cyan px-3 py-2.5 text-center text-sm font-semibold text-navy"
              >
                Launch Dashboard
              </Link>
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-border/50 bg-navy-secondary px-6 pb-10 pt-14">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 md:grid-cols-4">
          <div>
            <div className="mb-4 flex items-center gap-2">
              <Syringe className="h-5 w-5 text-cyan" aria-hidden="true" />
              <span className="font-display text-base font-bold tracking-tight text-text">
                VAXBRIDGE<span className="text-cyan"> AI</span>
              </span>
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-text-secondary/80">
              Every missed dose becomes an actionable next step. A prototype platform for vaccination record
              reconciliation and gap resolution.
            </p>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold text-text">Product</h4>
            <ul className="space-y-2 text-sm text-text-secondary/80">
              <li><Link href="/how-it-works" className="hover:text-cyan">How it works</Link></li>
              <li><Link href="/#features" className="hover:text-cyan">Features</Link></li>
              <li><Link href="/app" className="hover:text-cyan">Dashboard</Link></li>
              <li><Link href="/#ai" className="hover:text-cyan">Responsible AI</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold text-text">Trust</h4>
            <ul className="space-y-2 text-sm text-text-secondary/80">
              <li><Link href="/security" className="hover:text-cyan">Security</Link></li>
              <li><Link href="/privacy" className="hover:text-cyan">Privacy</Link></li>
              <li><Link href="/about" className="hover:text-cyan">About</Link></li>
              <li><Link href="/contact" className="hover:text-cyan">Contact</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold text-text">Documentation</h4>
            <ul className="space-y-2 text-sm text-text-secondary/80">
              <li>
                <a
                  href={`${process.env.NEXT_PUBLIC_API_URL || ""}/docs`}
                  className="hover:text-cyan"
                >
                  API reference
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/krishantsethi/vac"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="hover:text-cyan"
                >
                  Source repository
                </a>
              </li>
              <li><Link href="/about#disclaimer" className="hover:text-cyan">Prototype disclaimer</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
          <p className="text-xs leading-relaxed text-amber-200/80">
            <strong className="font-semibold text-amber-300">Prototype disclaimer.</strong> VAXBRIDGE AI is an
            independent demonstration prototype. It is not a government system and is not affiliated with, endorsed by,
            or integrated with CoWIN, U-WIN, ABDM, or any other official immunisation registry. It contains only
            synthetic demonstration data. No certification or regulatory compliance is claimed. Nothing here is medical
            advice; clinical decisions remain with qualified health professionals.
          </p>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-border/60 pt-6 text-xs text-text-secondary/60 sm:flex-row">
          <p>© {new Date().getFullYear()} VAXBRIDGE AI. Demonstration prototype.</p>
          <p>No company address or contact details are invented for this prototype.</p>
        </div>
      </div>
    </footer>
  );
}

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-navy text-text">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-cyan focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-navy"
      >
        Skip to main content
      </a>
      <PublicHeader />
      <main id="main-content" className="flex-1 pt-16">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
