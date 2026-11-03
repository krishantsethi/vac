"use client";

/**
 * Static artwork shown when WebGL is unavailable.
 *
 * A blocked canvas, a missing GPU, or a driver that throws on context creation
 * must degrade to something that still looks intentional — the sign-in screen
 * should not lose its visual identity because one browser feature is missing.
 * Pure CSS and SVG, so it costs nothing and cannot itself fail.
 */
export function LoginSceneFallback({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <div className="relative flex h-full w-full items-center justify-center">
        {/* Ambient glow */}
        <div
          className="absolute h-64 w-64 rounded-full opacity-70 blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(56,217,255,0.30) 0%, rgba(87,230,177,0.10) 45%, transparent 70%)" }}
        />

        {/* Outer protective sphere */}
        <svg viewBox="0 0 320 320" className="relative h-full max-h-[22rem] w-full max-w-[22rem]">
          <defs>
            <radialGradient id="lsg-core" cx="38%" cy="32%" r="72%">
              <stop offset="0%" stopColor="#1B4C6B" />
              <stop offset="55%" stopColor="#0B1728" />
              <stop offset="100%" stopColor="#07111F" />
            </radialGradient>
            <linearGradient id="lsg-cross" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#A8E9FF" />
              <stop offset="50%" stopColor="#38D9FF" />
              <stop offset="100%" stopColor="#57E6B1" />
            </linearGradient>
          </defs>

          <circle cx="160" cy="160" r="150" fill="none" stroke="#A8E9FF" strokeOpacity="0.10" strokeWidth="1" />
          <circle cx="160" cy="160" r="124" fill="none" stroke="#38D9FF" strokeOpacity="0.16" strokeWidth="1" strokeDasharray="3 7" />
          <circle cx="160" cy="160" r="96" fill="url(#lsg-core)" stroke="#38D9FF" strokeOpacity="0.30" strokeWidth="1" />

          {/* Orbiting ring, drawn as an ellipse for depth */}
          <ellipse
            cx="160"
            cy="160"
            rx="140"
            ry="46"
            fill="none"
            stroke="#57E6B1"
            strokeOpacity="0.28"
            strokeWidth="1"
            transform="rotate(-18 160 160)"
          />
          <ellipse
            cx="160"
            cy="160"
            rx="118"
            ry="38"
            fill="none"
            stroke="#38D9FF"
            strokeOpacity="0.22"
            strokeWidth="1"
            transform="rotate(24 160 160)"
          />

          {/* Medical cross */}
          <path
            d="M142 106h36v36h36v36h-36v36h-36v-36h-36v-36h36z"
            fill="url(#lsg-cross)"
            fillOpacity="0.92"
            stroke="#A8E9FF"
            strokeOpacity="0.55"
            strokeWidth="1"
          />

          {/* Data nodes */}
          {[
            [46, 118, 3.4],
            [276, 196, 3.0],
            [92, 258, 2.6],
            [238, 74, 2.8],
            [160, 30, 2.4],
            [286, 122, 2.2],
          ].map(([cx, cy, r], i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill={i % 2 ? "#57E6B1" : "#38D9FF"} fillOpacity="0.85" />
          ))}
        </svg>
      </div>
    </div>
  );
}

export default LoginSceneFallback;
