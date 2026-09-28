"use client";

import { useEffect, useRef, useState } from "react";

// The site's living backdrop: slow-drifting aurora blobs in the current
// season's palette, rising light motes, film grain and a vignette. On
// desktop it tilts gently with the mouse; the tint shifts with the time of
// day. Everything animates with transforms/opacity only (GPU-friendly) and
// holds still for people who prefer reduced motion.
//
// Fixed, full-viewport, behind everything (z-index 0), ignores clicks.

type Mote = { left: number; size: number; duration: number; delay: number; drift: number };

function daypart(hour: number) {
  if (hour >= 5 && hour < 10) return "morning";
  if (hour >= 10 && hour < 17) return "day";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

export default function AliveBackground() {
  const layerRef = useRef<HTMLDivElement>(null);
  // Randomness only after mount, so server and client HTML match.
  const [motes, setMotes] = useState<Mote[]>([]);

  useEffect(() => {
    const small = window.matchMedia("(max-width: 720px)").matches;
    const count = small ? 10 : 22;
    setMotes(
      Array.from({ length: count }, () => ({
        left: Math.random() * 100,
        size: 2 + Math.random() * 3.5,
        duration: 16 + Math.random() * 18,
        delay: -Math.random() * 30,
        drift: (Math.random() - 0.5) * 8,
      }))
    );

    const setPart = () => {
      document.documentElement.dataset.daypart = daypart(new Date().getHours());
    };
    setPart();
    const timer = window.setInterval(setPart, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Mouse parallax (desktop pointers only, and not for reduced motion).
  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = layerRef.current;
    if (!fine || calm || !el) return;
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        el.style.setProperty("--mx", String(e.clientX / window.innerWidth - 0.5));
        el.style.setProperty("--my", String(e.clientY / window.innerHeight - 0.5));
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="alive-bg" aria-hidden="true">
      <div className="parallax" ref={layerRef}>
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
        <span className="blob b4" />
        <span className="blob b5" />
      </div>
      <div className="motes">
        {motes.map((m, i) => (
          <span
            key={i}
            className="mote"
            style={
              {
                left: `${m.left}%`,
                width: m.size,
                height: m.size,
                animationDuration: `${m.duration}s`,
                animationDelay: `${m.delay}s`,
                "--drift": `${m.drift}vw`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div className="daypart-tint" />
      <div className="grain" />
      <div className="vignette" />
    </div>
  );
}
