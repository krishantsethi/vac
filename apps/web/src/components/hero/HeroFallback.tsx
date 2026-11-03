"use client";

import { cn } from "@/lib/utils";

/**
 * Polished static hero used when WebGL is unavailable, the device is
 * constrained, or the user prefers reduced motion.
 *
 * It conveys the same idea as the 3D scene — a protective shield around a
 * verified core, with record nodes linked to it — using SVG only, so layout
 * and meaning are preserved without a GPU.
 */
export function HeroFallback({ className }: { className?: string }) {
  const nodes = [
    { x: 78, y: 96, r: 6, color: "#38D9FF" },
    { x: 322, y: 128, r: 5, color: "#57E6B1" },
    { x: 62, y: 268, r: 5, color: "#A8E9FF" },
    { x: 336, y: 250, r: 6, color: "#38D9FF" },
    { x: 200, y: 44, r: 4, color: "#57E6B1" },
    { x: 150, y: 348, r: 4, color: "#A8E9FF" },
    { x: 268, y: 340, r: 5, color: "#38D9FF" },
  ];

  return (
    <div className={cn("relative flex h-full w-full items-center justify-center", className)}>
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-1/2 h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan/[0.08] blur-[90px]" />
      </div>

      <svg
        viewBox="0 0 400 400"
        className="relative h-full max-h-[520px] w-full"
        role="img"
        aria-label="Illustration of a protective shield surrounding a verified core, with vaccination record nodes linked to it"
      >
        <defs>
          <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop offset="35%" stopColor="#38D9FF" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#38D9FF" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="shieldStroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#38D9FF" />
            <stop offset="100%" stopColor="#57E6B1" />
          </linearGradient>
          <linearGradient id="shieldFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38D9FF" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#57E6B1" stopOpacity="0.03" />
          </linearGradient>
        </defs>

        {/* Outer energy rings */}
        <circle cx="200" cy="200" r="176" fill="none" stroke="#38D9FF" strokeOpacity="0.14" strokeWidth="1" />
        <circle
          cx="200"
          cy="200"
          r="158"
          fill="none"
          stroke="#57E6B1"
          strokeOpacity="0.2"
          strokeWidth="1.2"
          strokeDasharray="4 9"
        />

        {/* Translucent protective shield */}
        <path
          d="M200 74 L300 112 V206 C300 268 258 312 200 330 C142 312 100 268 100 206 V112 Z"
          fill="url(#shieldFill)"
          stroke="url(#shieldStroke)"
          strokeWidth="1.8"
          strokeOpacity="0.75"
        />

        {/* DNA-inspired helix inside the shield */}
        <g strokeOpacity="0.55" fill="none" strokeWidth="1.6">
          <path
            d="M172 128 C212 150 188 176 228 198 C188 220 212 246 172 268"
            stroke="#57E6B1"
          />
          <path
            d="M228 128 C188 150 212 176 172 198 C212 220 188 246 228 268"
            stroke="#38D9FF"
          />
        </g>
        <g stroke="#A8E9FF" strokeOpacity="0.3" strokeWidth="1">
          <path d="M180 140 L220 140" />
          <path d="M186 162 L214 162" />
          <path d="M186 234 L214 234" />
          <path d="M180 256 L220 256" />
        </g>

        {/* Core glow and verified core */}
        <circle cx="200" cy="198" r="62" fill="url(#coreGlow)" />
        <circle cx="200" cy="198" r="26" fill="#0B1728" stroke="#38D9FF" strokeWidth="1.6" strokeOpacity="0.8" />
        <path
          d="M189 198 L197 206 L212 190"
          fill="none"
          stroke="#57E6B1"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Connection lines from core to record nodes */}
        <g strokeOpacity="0.3" strokeWidth="1.2" fill="none">
          {nodes.map((n, i) => (
            <path
              key={i}
              d={`M200 198 L${n.x} ${n.y}`}
              stroke={n.color}
              strokeDasharray="3 6"
            />
          ))}
        </g>

        {/* Record nodes */}
        {nodes.map((n, i) => (
          <g key={i}>
            <circle cx={n.x} cy={n.y} r={n.r + 5} fill={n.color} fillOpacity="0.12" />
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.color} fillOpacity="0.9" />
          </g>
        ))}
      </svg>

      <p className="absolute bottom-1 text-[11px] text-text-secondary/50">
        Static illustration — the interactive WebGL scene is paused or unavailable.
      </p>
    </div>
  );
}

export default HeroFallback;
