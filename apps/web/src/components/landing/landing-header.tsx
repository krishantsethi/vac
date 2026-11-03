"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, Syringe, X } from "lucide-react";
import { cn } from "@/lib/utils";

const SECTION_LINKS = [
  { label: "Problem", href: "#problem" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
  { label: "Responsible AI", href: "#responsible-ai" },
];

const PAGE_LINKS = [
  { label: "Security", href: "/security" },
  { label: "About", href: "/about" },
];

/**
 * Transparent over the hero, then a subtle dark surface once scrolled.
 */
export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled
          ? "border-b border-border bg-navy/85 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="VAXBRIDGE AI home">
          <Syringe className="h-5 w-5 text-cyan" aria-hidden="true" />
          <span className="font-display text-lg font-bold tracking-tight text-text">
            VAXBRIDGE<span className="text-cyan"> AI</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex" aria-label="Main">
          {SECTION_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="text-sm font-medium text-text-secondary transition-colors hover:text-cyan"
            >
              {l.label}
            </a>
          ))}
          {PAGE_LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="text-sm font-medium text-text-secondary transition-colors hover:text-cyan"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link
            href="/login"
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:border-cyan/40 hover:text-cyan"
          >
            Sign in
          </Link>
          <Link
            href="/app"
            className="rounded-md bg-cyan px-3.5 py-1.5 text-sm font-semibold text-navy shadow-[0_0_20px_rgba(56,217,255,0.35)] transition-shadow hover:shadow-[0_0_32px_rgba(56,217,255,0.55)]"
          >
            Launch Dashboard
          </Link>
        </div>

        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-md p-2 text-text-secondary transition-colors hover:text-cyan lg:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-nav"
        >
          {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>

      {open && (
        <nav
          id="mobile-nav"
          className="border-t border-border bg-navy/95 px-6 py-4 backdrop-blur-md lg:hidden"
          aria-label="Mobile"
        >
          <div className="flex flex-col gap-1">
            {[...SECTION_LINKS.map((l) => ({ ...l, external: false })), ...PAGE_LINKS.map((l) => ({ ...l, external: true }))].map(
              (l) =>
                l.external ? (
                  <Link
                    key={l.label}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="rounded-md px-3 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface hover:text-cyan"
                  >
                    {l.label}
                  </Link>
                ) : (
                  <a
                    key={l.label}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="rounded-md px-3 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface hover:text-cyan"
                  >
                    {l.label}
                  </a>
                )
            )}
            <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3">
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-3 py-2.5 text-center text-sm font-medium text-text-secondary hover:text-cyan"
              >
                Sign in
              </Link>
              <Link
                href="/app"
                onClick={() => setOpen(false)}
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
