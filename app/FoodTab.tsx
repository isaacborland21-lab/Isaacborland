"use client";

import { useState } from "react";

const mono = "'IBM Plex Mono', monospace";
const sans = "'IBM Plex Sans', sans-serif";

type Meal = { day: string; name: string; note: string; batch: "Sunday prep" | "Wednesday prep" | "Cook fresh" };

const lunches: Meal[] = [
  { day: "Mon", name: "Cilantro-lime chicken burrito bowls", note: "Rice, black beans, corn salsa, chicken. Make 3 at once.", batch: "Sunday prep" },
  { day: "Tue", name: "Greek chicken quinoa bowls", note: "Cucumber, tomato, feta, tzatziki on the side so it stays crisp.", batch: "Sunday prep" },
  { day: "Wed", name: "Beef & broccoli with rice", note: "Reheats great. Keep sauce thick so rice doesn't go soggy.", batch: "Sunday prep" },
  { day: "Thu", name: "Pesto chicken pasta salad", note: "Eat cold. Cherry tomatoes, mozzarella, spinach.", batch: "Wednesday prep" },
  { day: "Fri", name: "Peanut chicken noodles", note: "Rice noodles, shredded carrot, cabbage. Good cold or warm.", batch: "Wednesday prep" },
  { day: "Sat", name: "Turkey chili", note: "Make a big pot, freeze extra portions.", batch: "Wednesday prep" },
  { day: "Sun", name: "BBQ pulled pork sweet potato bowls", note: "Slow cooker pork, roasted sweet potato, slaw.", batch: "Wednesday prep" },
];

const dinners: Meal[] = [
  { day: "Mon", name: "Sheet-pan sausage, peppers & potatoes", note: "One pan, 35 min. Portion into 3 containers.", batch: "Sunday prep" },
  { day: "Tue", name: "Slow-cooker chicken tikka masala", note: "Serve over rice. Tastes better on day 2.", batch: "Sunday prep" },
  { day: "Wed", name: "Baked ziti", note: "Assemble Sunday, bake the night you eat it. Freezes well.", batch: "Sunday prep" },
  { day: "Thu", name: "Honey-garlic salmon & green beans", note: "Don't prep fish ahead \u2014 reheated salmon is rough. 20 min fresh.", batch: "Cook fresh" },
  { day: "Fri", name: "Steak fajitas", note: "Pre-slice peppers, onions & marinate steak Wednesday. Cook in 15 min.", batch: "Wednesday prep" },
  { day: "Sat", name: "Shepherd's pie", note: "Ground beef, veggies, mashed potato top. Freezes well.", batch: "Wednesday prep" },
  { day: "Sun", name: "Roasted chicken thighs & veggies", note: "Cook extra thighs \u2014 they become next week's lunches.", batch: "Cook fresh" },
];

const batchColor: Record<Meal["batch"], string> = {
  "Sunday prep": "var(--accent)",
  "Wednesday prep": "#7fb3d5",
  "Cook fresh": "#8fbf7f",
};

export default function FoodTab() {
  const [view, setView] = useState<"Lunch" | "Dinner">("Lunch");
  const meals = view === "Lunch" ? lunches : dinners;

  return (
    <div
      style={{
        border: "1px solid var(--surface-border)",
        background: "var(--surface)",
        borderRadius: 6,
        padding: "24px",
      }}
    >
      <h2 style={{ fontFamily: mono, fontWeight: 600, fontSize: 20, margin: "0 0 8px 0" }}>One-week meal prep</h2>
      <p style={{ fontFamily: sans, fontSize: 14, lineHeight: 1.6, color: "var(--text-dim)", margin: "0 0 20px 0" }}>
        Two prep sessions: <strong>Sunday</strong> covers Mon\u2013Wed, <strong>Wednesday</strong> covers Thu\u2013Sun. Cooked
        food only holds 3\u20134 days in the fridge, so one giant Sunday prep for all 7 days isn\u2019t safe \u2014 split it or freeze
        the back half.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["Lunch", "Dinner"] as const).map((v) => {
          const on = v === view;
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                fontFamily: sans,
                fontSize: 13,
                fontWeight: 600,
                padding: "6px 16px",
                borderRadius: 999,
                cursor: "pointer",
                border: on ? "1px solid var(--accent)" : "1px solid var(--surface-border)",
                background: on ? "var(--accent)" : "none",
                color: on ? "#1a0f08" : "var(--text-dim)",
              }}
            >
              {v}
            </button>
          );
        })}
      </div>

      <div>
        {meals.map((m, i) => (
          <div
            key={m.day}
            style={{
              display: "flex",
              gap: 14,
              padding: "14px 0",
              borderTop: i === 0 ? "none" : "1px solid var(--surface-border)",
            }}
          >
            <span style={{ fontFamily: mono, fontSize: 12, color: "var(--accent)", width: 32, flexShrink: 0, paddingTop: 2 }}>
              {m.day}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <span style={{ fontFamily: sans, fontSize: 15, fontWeight: 600 }}>{m.name}</span>
                <span style={{ fontFamily: mono, fontSize: 10, color: batchColor[m.batch], textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {m.batch}
                </span>
              </div>
              <p style={{ fontFamily: sans, fontSize: 13, lineHeight: 1.5, color: "var(--text-dim)", margin: "4px 0 0 0" }}>{m.note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
