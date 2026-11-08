"use client";

import { useEffect, useState } from "react";
import { Toaster as Sonner } from "sonner";

// One toaster for the whole site. On phones it sits just above the bottom
// tab bar so a "Saved" never covers the nav.
export default function Toaster() {
  const [hasBottomBar, setHasBottomBar] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setHasBottomBar(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const bottom = hasBottomBar ? "calc(var(--bottombar-h) + 22px + env(safe-area-inset-bottom, 0px))" : 24;

  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      offset={{ bottom }}
      mobileOffset={{ bottom, left: 14, right: 14 }}
      gap={8}
      toastOptions={{
        style: {
          background: "color-mix(in srgb, var(--surface) 94%, var(--bg))",
          border: "1px solid var(--line-strong)",
          color: "var(--text)",
          fontFamily: "var(--sans)",
          fontSize: 14,
          borderRadius: 14,
          boxShadow: "0 18px 40px -16px rgba(0, 0, 0, 0.8)",
        },
      }}
    />
  );
}
