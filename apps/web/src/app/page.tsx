"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { ArrowRight, Pause, Play, ShieldAlert, Activity } from "lucide-react";
import { LandingHeader } from "@/components/landing/landing-header";
import { PublicFooter } from "@/components/layout/public-shell";
import { HeroFallback } from "@/components/hero/HeroFallback";
import { SceneBoundary } from "@/components/hero/scene-boundary";
import { ProblemSection } from "@/components/landing/problem-section";
import { WorkflowSection } from "@/components/landing/workflow-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { PreviewSection } from "@/components/landing/preview-section";
import { ResponsibleAiSection } from "@/components/landing/responsible-ai-section";
import { SecuritySection } from "@/components/landing/security-section";

// Lazy-load the WebGL scene so it never blocks first paint.
const Hero3D = dynamic(() => import("@/components/hero/Hero3D").then((m) => m.Hero3D), {
  ssr: false,
  loading: () => <HeroFallback className="h-full w-full" />,
});

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function useWebglSupported() {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl2") ||
        canvas.getContext("webgl") ||
        canvas.getContext("experimental-webgl");
      setSupported(Boolean(gl));
    } catch {
      setSupported(false);
    }
  }, []);
  return supported;
}

export default function Home() {
  const prefersReduced = usePrefersReducedMotion();
  const webgl = useWebglSupported();
  const [paused, setPaused] = useState(false);

  const reducedMotion = prefersReduced || paused;
  const show3D = webgl === true && !reducedMotion;

  return (
    <div className="relative flex min-h-screen flex-col bg-navy text-text selection:bg-cyan/30">
      <LandingHeader />

      <main id="main-content" className="flex-1">
        {/* ── Section 2: cinematic hero ─────────────────────────────── */}
        <section className="relative overflow-hidden px-6 pb-20 pt-28 lg:pb-28 lg:pt-36">
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute -left-40 top-0 h-[520px] w-[520px] rounded-full bg-cyan/[0.07] blur-[130px]" />
            <div className="absolute -right-32 bottom-0 h-[420px] w-[420px] rounded-full bg-mint/[0.06] blur-[130px]" />
          </div>

          <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10">
            <motion.div
              initial={prefersReduced ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            >
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan/25 bg-cyan/[0.08] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan">
                <Activity className="h-3 w-3" aria-hidden="true" />
                Intelligent Immunization Infrastructure
              </p>

              <h1 className="font-display text-4xl font-bold leading-[1.06] tracking-tight text-text sm:text-5xl lg:text-[3.9rem]">
                Turn Every Vaccination Gap Into a{" "}
                <span className="bg-gradient-to-r from-cyan to-mint bg-clip-text text-transparent">
                  Clear Next Step.
                </span>
              </h1>

              <p className="mt-6 max-w-xl text-base leading-relaxed text-text-secondary md:text-lg">
                Unify vaccination records, resolve uncertainty, prioritize follow-up, and help healthcare teams turn
                immunization data into actionable outcomes.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/app"
                  className="group inline-flex items-center justify-center gap-2 rounded-md bg-cyan px-5 py-3 text-sm font-semibold text-navy shadow-[0_0_24px_rgba(56,217,255,0.35)] transition-shadow hover:shadow-[0_0_38px_rgba(56,217,255,0.55)]"
                >
                  Explore the Platform
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center justify-center rounded-md border border-border px-5 py-3 text-sm font-medium text-text transition-colors hover:border-cyan/40 hover:text-cyan"
                >
                  See How It Works
                </a>
              </div>

              <p className="mt-7 flex items-start gap-2 text-sm text-text-secondary/75">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-mint" aria-hidden="true" />
                Built for explainability, responsible AI, and connected healthcare workflows.
              </p>
            </motion.div>

            <div className="relative">
              <div className="relative mx-auto aspect-square w-full max-w-[560px]">
                {webgl === null ? (
                  <div className="h-full w-full rounded-2xl border border-border/50 bg-surface/40" aria-hidden="true" />
                ) : show3D ? (
                  <SceneBoundary label="Hero 3D scene" fallback={<HeroFallback className="h-full w-full" />}>
                    <Hero3D className="h-full w-full" reducedMotion={reducedMotion} />
                  </SceneBoundary>
                ) : (
                  <HeroFallback className="h-full w-full" />
                )}

                {/* Illustrative labels — UI elements, not real-world metrics */}
                {[
                  { label: "Verified Records", className: "left-0 top-[16%]", tone: "text-cyan border-cyan/30" },
                  { label: "Intelligent Follow-Up", className: "right-0 top-[34%]", tone: "text-mint border-mint/30" },
                  { label: "Connected Care", className: "left-[4%] bottom-[26%]", tone: "text-ice border-ice/25" },
                  { label: "Actionable Insights", className: "right-[2%] bottom-[12%]", tone: "text-cyan border-cyan/30" },
                ].map((chip) => (
                  <span
                    key={chip.label}
                    className={`pointer-events-none absolute hidden rounded-full border bg-navy/80 px-3 py-1 text-[11px] font-medium backdrop-blur-sm sm:block ${chip.className} ${chip.tone}`}
                  >
                    {chip.label}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-center gap-3 text-[11px] text-text-secondary/70">
                <span>
                  {webgl === false
                    ? "WebGL unavailable — showing the static illustration."
                    : prefersReduced
                      ? "Reduced-motion preference detected — animation paused."
                      : "Interactive WebGL scene."}
                </span>
                {webgl === true && !prefersReduced && (
                  <button
                    onClick={() => setPaused((p) => !p)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:border-cyan/40 hover:text-cyan"
                    aria-pressed={paused}
                  >
                    {paused ? <Play className="h-3 w-3" aria-hidden="true" /> : <Pause className="h-3 w-3" aria-hidden="true" />}
                    {paused ? "Resume motion" : "Pause motion"}
                  </button>
                )}
              </div>
              <p className="mt-2 text-center text-[11px] text-text-secondary/50">
                Labels are illustrative interface elements, not measured statistics.
              </p>
            </div>
          </div>
        </section>

        <ProblemSection />
        <WorkflowSection />
        <FeaturesSection />
        <PreviewSection />
        <ResponsibleAiSection />
        <SecuritySection />

        {/* ── Section 9: final CTA ──────────────────────────────────── */}
        <section className="px-6 py-20 lg:py-28">
          <div className="mx-auto max-w-4xl">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-surface px-6 py-14 text-center md:px-16">
              <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                <div className="absolute left-1/2 top-0 h-64 w-[420px] -translate-x-1/2 rounded-full bg-cyan/[0.09] blur-[100px]" />
              </div>
              <div className="relative">
                <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-text md:text-4xl">
                  Build a Clearer Path From Vaccination Records to Action
                </h2>
                <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-text-secondary">
                  Explore every role-specific view on synthetic demonstration data — patients, healthcare workers,
                  clinic and public-health administrators.
                </p>
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Link
                    href="/app"
                    className="group inline-flex items-center gap-2 rounded-md bg-cyan px-6 py-3 text-sm font-semibold text-navy shadow-[0_0_24px_rgba(56,217,255,0.35)] transition-shadow hover:shadow-[0_0_38px_rgba(56,217,255,0.55)]"
                  >
                    Launch VAXBRIDGE AI
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </Link>
                  <Link
                    href="/login"
                    className="inline-flex items-center rounded-md border border-border px-6 py-3 text-sm font-medium text-text transition-colors hover:border-cyan/40 hover:text-cyan"
                  >
                    Use a demo account
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
