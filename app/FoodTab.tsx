"use client";

import { useEffect, useMemo, useState } from "react";
import { BATCHES, Batch, DEFAULT_PLAN, MealPlanData, PlanMeal } from "./foodDefaults";
import { buildGroceryList, groceryListToText } from "@/lib/grocery";
import { buildRefreshedPlan, openSlots, splitCounts, RefreshMode, WebIdea } from "@/lib/planRefresh";

const mono = "'IBM Plex Mono', monospace";
const sans = "'IBM Plex Sans', sans-serif";

// ---------- Types ----------

export type Recipe = { id: string; name: string; ingredients: string; steps: string; source?: string };
export type Todo = { id: string; text: string; done: boolean };
export type FoodContent = { recipes: Recipe[]; todos: Todo[]; plan?: MealPlanData };

type MealKind = "lunch" | "dinner";

const batchColor: Record<Batch, string> = {
  "Sunday prep": "var(--accent)",
  "Wednesday prep": "#7fb3d5",
  "Cook fresh": "#8fbf7f",
};

// ---------- Shared styles ----------

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--surface-border)",
  borderRadius: 4,
  color: "var(--text)",
  fontFamily: sans,
  fontSize: 14,
  padding: "8px 10px",
  boxSizing: "border-box",
};

const primaryBtn: React.CSSProperties = {
  fontFamily: sans,
  fontSize: 13,
  padding: "8px 14px",
  borderRadius: 4,
  cursor: "pointer",
  background: "var(--accent)",
  border: "none",
  color: "#1a0f08",
  fontWeight: 600,
};

const ghostBtn: React.CSSProperties = {
  fontFamily: sans,
  fontSize: 13,
  padding: "8px 14px",
  borderRadius: 4,
  cursor: "pointer",
  background: "none",
  border: "1px solid var(--surface-border)",
  color: "var(--text-dim)",
};

const linkBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontFamily: mono,
  fontSize: 12,
  color: "var(--accent)",
  padding: 0,
};

const dimText: React.CSSProperties = { fontFamily: sans, fontSize: 13, lineHeight: 1.5, color: "var(--text-dim)", margin: 0 };
const errorStyle: React.CSSProperties = { fontFamily: sans, fontSize: 13, color: "#e88", margin: "8px 0 0 0" };
const labelStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 11,
  color: "var(--accent)",
  textTransform: "uppercase",
  margin: "0 0 4px 0",
};

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function lines(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function Pill({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
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
      {label}
    </button>
  );
}

function useIsWide(minWidth = 1024) {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [minWidth]);
  return wide;
}

// Ingredients for a plan slot: the linked recipe's if there is one, else the slot's own.
function slotIngredients(meal: PlanMeal, recipes: Recipe[]): string[] {
  if (meal.recipeId) {
    const r = recipes.find((x) => x.id === meal.recipeId);
    if (r) return lines(r.ingredients);
  }
  return lines(meal.ingredients ?? "");
}

// ---------- Meal slot editor ----------

function MealEditForm({
  meal,
  recipes,
  saving,
  onSave,
  onCancel,
}: {
  meal: PlanMeal;
  recipes: Recipe[];
  saving: boolean;
  onSave: (m: PlanMeal) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(meal.name);
  const [note, setNote] = useState(meal.note);
  const [batch, setBatch] = useState<Batch>(meal.batch);
  const [recipeId, setRecipeId] = useState(meal.recipeId ?? "");
  const [ingredients, setIngredients] = useState(meal.ingredients ?? "");
  const linked = recipes.find((r) => r.id === recipeId);

  return (
    <div style={{ border: "1px solid var(--surface-border)", borderRadius: 6, padding: 14, margin: "8px 0" }}>
      <p style={labelStyle}>{meal.day}</p>

      {recipes.length > 0 && (
        <>
          <select
            value={recipeId}
            onChange={(e) => {
              const id = e.target.value;
              setRecipeId(id);
              const r = recipes.find((x) => x.id === id);
              if (r) setName(r.name);
            }}
            style={{ ...inputStyle, marginBottom: 10 }}
          >
            <option value="">Custom meal (type it below)</option>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                Use saved recipe: {r.name}
              </option>
            ))}
          </select>
        </>
      )}

      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Meal name" style={inputStyle} />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Prep note (optional)"
        style={{ ...inputStyle, marginTop: 10 }}
      />
      <select value={batch} onChange={(e) => setBatch(e.target.value as Batch)} style={{ ...inputStyle, marginTop: 10 }}>
        {BATCHES.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>

      {linked ? (
        <p style={{ ...dimText, fontSize: 12, marginTop: 10 }}>
          Grocery list will use the {lines(linked.ingredients).length} ingredients from your saved recipe.
        </p>
      ) : (
        <textarea
          value={ingredients}
          onChange={(e) => setIngredients(e.target.value)}
          placeholder={"Ingredients for the grocery list (one per line)\n1.5 lb chicken breast\n1 cup rice"}
          rows={5}
          style={{ ...inputStyle, marginTop: 10, resize: "vertical" }}
        />
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          style={primaryBtn}
          disabled={saving || name.trim().length === 0}
          onClick={() => {
            const next: PlanMeal = { day: meal.day, name: name.trim(), note: note.trim(), batch };
            if (meal.locked) next.locked = true;
            if (linked) next.recipeId = linked.id;
            else {
              if (ingredients.trim()) next.ingredients = ingredients.trim();
              if (meal.source) next.source = meal.source;
              if (meal.steps) next.steps = meal.steps;
            }
            onSave(next);
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button style={ghostBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- Grocery list panel ----------

function GroceryPanel({ plan, recipes, onClose }: { plan: MealPlanData; recipes: Recipe[]; onClose: () => void }) {
  const [useLunch, setUseLunch] = useState(true);
  const [useDinner, setUseDinner] = useState(true);
  const [copied, setCopied] = useState(false);

  const { sections, text, missing } = useMemo(() => {
    const meals = [...(useLunch ? plan.lunch : []), ...(useDinner ? plan.dinner : [])];
    const all: string[] = [];
    const missing: string[] = [];
    for (const m of meals) {
      const ing = slotIngredients(m, recipes);
      if (ing.length === 0) missing.push(`${m.day}: ${m.name}`);
      all.push(...ing);
    }
    const sections = buildGroceryList(all);
    const text = groceryListToText(sections, "Grocery list (isaacborland.com)");
    return { sections, text, missing };
  }, [plan, recipes, useLunch, useDinner]);

  const itemCount = sections.reduce((n, s) => n + s.items.length, 0);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grocery-list-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ border: "1px solid var(--accent)", borderRadius: 6, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 600 }}>Grocery list · {itemCount} items</span>
        <button style={linkBtn} onClick={onClose}>
          Close
        </button>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
        {(
          [
            ["Lunches", useLunch, setUseLunch],
            ["Dinners", useDinner, setUseDinner],
          ] as const
        ).map(([label, on, set]) => (
          <label key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: sans, fontSize: 13, color: "var(--text-dim)" }}>
            <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
            {label}
          </label>
        ))}
      </div>

      {missing.length > 0 && (
        <p style={{ ...dimText, fontSize: 12, color: "#e8b86a", marginBottom: 10 }}>
          No ingredients listed for {missing.length} meal{missing.length === 1 ? "" : "s"} (not in this list): {missing.join(", ")}.
        </p>
      )}

      {sections.length === 0 ? (
        <p style={dimText}>Nothing to buy yet.</p>
      ) : (
        <div style={{ maxHeight: 360, overflowY: "auto", marginBottom: 12 }}>
          {sections.map((s) => (
            <div key={s.section} style={{ marginBottom: 12 }}>
              <p style={labelStyle}>{s.section}</p>
              <ul style={{ ...dimText, paddingLeft: 18, margin: 0 }}>
                {s.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={primaryBtn} disabled={itemCount === 0} onClick={copy}>
          {copied ? "Copied!" : "Copy list"}
        </button>
        <button style={ghostBtn} disabled={itemCount === 0} onClick={download}>
          Download .txt
        </button>
      </div>
      <p style={{ ...dimText, fontSize: 11, marginTop: 8 }}>
        Same items are added up (1 cup + 1 cup rice = 2 cup). Different units (lb vs oz) aren&rsquo;t converted.
      </p>
    </div>
  );
}

// ---------- Meal plan ----------

const MODES: { value: RefreshMode; label: string; hint: string }[] = [
  { value: "mix", label: "Mine + web", hint: "About half from your recipes, the rest new ideas from online" },
  { value: "mine", label: "My recipes only", hint: "Shuffle your saved recipes into the week" },
  { value: "web", label: "All new from web", hint: "Every open day gets a new recipe from online" },
];

function MealPlan({
  plan,
  recipes,
  editable,
  saving,
  onSavePlan,
  onSaveRecipeFromSlot,
}: {
  plan: MealPlanData;
  recipes: Recipe[];
  editable: boolean;
  saving: boolean;
  onSavePlan: (next: MealPlanData) => Promise<boolean>;
  onSaveRecipeFromSlot: (kind: MealKind, index: number) => Promise<boolean>;
}) {
  const [view, setView] = useState<MealKind>("lunch");
  const [editing, setEditing] = useState<string | null>(null); // "lunch:Mon"
  const [showGroceries, setShowGroceries] = useState(false);
  const wide = useIsWide();

  // Refresh week
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [kinds, setKinds] = useState<{ lunch: boolean; dinner: boolean }>({ lunch: true, dinner: true });
  const [mode, setMode] = useState<RefreshMode>(recipes.length > 0 ? "mix" : "web");
  const [busy, setBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ plan: MealPlanData; notes: string[] } | null>(null);

  const shown = draft ? draft.plan : plan;
  const kindsShown: MealKind[] = wide ? ["lunch", "dinner"] : [view];

  async function runRefresh() {
    const ks = (["lunch", "dinner"] as const).filter((k) => kinds[k]);
    if (ks.length === 0) {
      setRefreshError("Pick lunch, dinner, or both.");
      return;
    }
    setBusy(true);
    setRefreshError(null);
    try {
      const slots = openSlots(plan, ks);
      const { nWeb } = splitCounts(slots.length, recipes.length, mode);
      let web: WebIdea[] = [];
      if (nWeb > 0) {
        const res = await fetch("/api/meal-ideas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ count: nWeb, exclude: [...plan.lunch, ...plan.dinner].map((m) => m.name) }),
        });
        const data = (await res.json().catch(() => ({}))) as { meals?: WebIdea[]; error?: string };
        if (!res.ok) throw new Error(data.error || "Couldn't fetch new recipes.");
        web = data.meals ?? [];
      }
      setDraft(buildRefreshedPlan(plan, ks, mode, recipes, web));
      setEditing(null);
      setRefreshOpen(false);
    } catch (e) {
      setRefreshError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const lockedCount = [...plan.lunch, ...plan.dinner].filter((m) => m.locked).length;

  return (
    <>
      <p style={{ ...dimText, fontSize: 14, marginBottom: 16 }}>
        Two prep sessions: <strong>Sunday</strong> covers Mon–Wed, <strong>Wednesday</strong> covers Thu–Sun. Cooked food
        holds 3–4 days in the fridge, so anything eaten 4 days out gets frozen and thawed the night before.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        {!wide && (["lunch", "dinner"] as const).map((v) => (
          <Pill
            key={v}
            label={v === "lunch" ? "Lunch" : "Dinner"}
            on={v === view}
            onClick={() => {
              setView(v);
              setEditing(null);
            }}
          />
        ))}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {editable && !draft && (
            <button style={{ ...ghostBtn, padding: "6px 12px" }} onClick={() => setRefreshOpen((o) => !o)}>
              ↻ Refresh week
            </button>
          )}
          <button style={{ ...ghostBtn, padding: "6px 12px" }} onClick={() => setShowGroceries((s) => !s)}>
            {showGroceries ? "Hide grocery list" : "Export grocery list"}
          </button>
        </span>
      </div>

      {refreshOpen && !draft && (
        <div style={{ border: "1px solid var(--accent)", borderRadius: 6, padding: 16, marginBottom: 16 }}>
          <p style={{ fontFamily: mono, fontSize: 14, fontWeight: 600, margin: "0 0 10px 0" }}>Refresh week</p>

          <p style={labelStyle}>Which meals</p>
          <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
            {(["lunch", "dinner"] as const).map((k) => (
              <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: sans, fontSize: 13, color: "var(--text-dim)" }}>
                <input type="checkbox" checked={kinds[k]} onChange={(e) => setKinds((prev) => ({ ...prev, [k]: e.target.checked }))} />
                {k === "lunch" ? "Lunches" : "Dinners"}
              </label>
            ))}
          </div>

          <p style={labelStyle}>Where recipes come from</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {MODES.map((m) => {
              const disabled = m.value === "mine" && recipes.length === 0;
              return (
                <label
                  key={m.value}
                  style={{ display: "flex", alignItems: "flex-start", gap: 8, fontFamily: sans, fontSize: 13, color: disabled ? "var(--surface-border)" : "var(--text)" }}
                >
                  <input type="radio" name="refresh-mode" checked={mode === m.value} disabled={disabled} onChange={() => setMode(m.value)} style={{ marginTop: 3 }} />
                  <span>
                    {m.label}
                    <span style={{ display: "block", fontSize: 12, color: "var(--text-dim)" }}>
                      {disabled ? "Save some recipes first" : m.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <p style={{ ...dimText, fontSize: 12, marginBottom: 12 }}>
            {lockedCount > 0
              ? `${lockedCount} locked day${lockedCount === 1 ? "" : "s"} will be kept. `
              : "Tip: lock any day you want to keep before refreshing. "}
            You&rsquo;ll see a preview before anything is saved.
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            <button style={primaryBtn} disabled={busy} onClick={runRefresh}>
              {busy ? "Finding recipes…" : "Build new week"}
            </button>
            <button style={ghostBtn} onClick={() => setRefreshOpen(false)}>
              Cancel
            </button>
          </div>
          {refreshError && <p style={errorStyle}>{refreshError}</p>}
        </div>
      )}

      {draft && (
        <div style={{ border: "1px solid #8fbf7f", borderRadius: 6, padding: 14, marginBottom: 16 }}>
          <p style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, margin: "0 0 4px 0", color: "#8fbf7f" }}>Preview · not saved yet</p>
          <p style={{ ...dimText, fontSize: 12 }}>Check lunch and dinner, then save it or shuffle again.</p>
          {draft.notes.map((n) => (
            <p key={n} style={{ ...dimText, fontSize: 12, color: "#e8b86a", marginTop: 6 }}>
              {n}
            </p>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button
              style={primaryBtn}
              disabled={saving || busy}
              onClick={async () => {
                if (await onSavePlan(draft.plan)) setDraft(null);
              }}
            >
              {saving ? "Saving…" : "Save this week"}
            </button>
            <button style={ghostBtn} disabled={busy || saving} onClick={runRefresh}>
              {busy ? "Shuffling…" : "Shuffle again"}
            </button>
            <button style={ghostBtn} disabled={busy || saving} onClick={() => setDraft(null)}>
              Discard
            </button>
          </div>
          {refreshError && <p style={errorStyle}>{refreshError}</p>}
        </div>
      )}

      {showGroceries && <GroceryPanel plan={shown} recipes={recipes} onClose={() => setShowGroceries(false)} />}

      <div className={wide ? "meal-columns" : undefined}>
        {kindsShown.map((kind) => (
          <div key={kind}>
            {wide && (
              <p style={{ ...labelStyle, fontSize: 12, letterSpacing: "0.06em", marginBottom: 2 }}>{kind === "lunch" ? "Lunch" : "Dinner"}</p>
            )}
            {shown[kind].map((m, i) =>
              editing === `${kind}:${m.day}` && !draft ? (
                <MealEditForm
                  key={m.day}
                  meal={m}
                  recipes={recipes}
                  saving={saving}
                  onCancel={() => setEditing(null)}
                  onSave={async (next) => {
                    const updated = { ...plan, [kind]: plan[kind].map((x) => (x.day === m.day ? next : x)) };
                    if (await onSavePlan(updated)) setEditing(null);
                  }}
                />
              ) : (
                <div
                  key={m.day}
                  style={{ display: "flex", gap: 14, padding: "14px 0", borderTop: i === 0 ? "none" : "1px solid var(--surface-border)" }}
                >
                  <span style={{ fontFamily: mono, fontSize: 12, color: "var(--accent)", width: 32, flexShrink: 0, paddingTop: 2 }}>{m.day}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                      <span style={{ fontFamily: sans, fontSize: 15, fontWeight: 600 }}>
                        {m.locked && <span title="Locked: refresh keeps this day">🔒 </span>}
                        {m.name}
                      </span>
                      <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                        <span style={{ fontFamily: mono, fontSize: 10, color: batchColor[m.batch], textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          {m.batch}
                        </span>
                        {editable && !draft && (
                          <>
                            <button
                              style={{ ...linkBtn, color: m.locked ? "var(--accent)" : "var(--text-dim)" }}
                              disabled={saving}
                              onClick={() =>
                                onSavePlan({ ...plan, [kind]: plan[kind].map((x, j) => (j === i ? { ...x, locked: !x.locked } : x)) })
                              }
                            >
                              {m.locked ? "Unlock" : "Lock"}
                            </button>
                            <button style={linkBtn} onClick={() => setEditing(`${kind}:${m.day}`)}>
                              Edit
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                    {m.note && <p style={{ ...dimText, marginTop: 4 }}>{m.note}</p>}
                    {m.recipeId && recipes.some((r) => r.id === m.recipeId) && (
                      <p style={{ fontFamily: mono, fontSize: 11, color: "var(--text-dim)", margin: "4px 0 0 0" }}>↳ from your saved recipes</p>
                    )}
                    {m.source && !m.recipeId && (
                      <p style={{ fontFamily: mono, fontSize: 11, margin: "4px 0 0 0", display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <a href={m.source} target="_blank" rel="noopener noreferrer">
                          View recipe ↗
                        </a>
                        {editable && !draft && (
                          <button style={{ ...linkBtn, fontSize: 11 }} disabled={saving} onClick={() => onSaveRecipeFromSlot(kind, i)}>
                            + Save to my recipes
                          </button>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        ))}
      </div>

      {editable && !draft && (
        <button
          style={{ ...linkBtn, marginTop: 14, color: "var(--text-dim)" }}
          onClick={() => {
            if (window.confirm("Reset lunches and dinners back to the default plan? Your edits to the plan will be lost (recipes and to-dos stay).")) {
              onSavePlan(DEFAULT_PLAN);
              setEditing(null);
            }
          }}
        >
          Reset plan to default
        </button>
      )}
    </>
  );
}

// ---------- Recipes ----------

type Imported = { name: string; ingredients: string[]; steps: string[]; source: string };

function RecipeForm({
  initial,
  onSubmit,
  onCancel,
  saving,
}: {
  initial: Recipe;
  onSubmit: (r: Recipe) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [ingredients, setIngredients] = useState(initial.ingredients);
  const [steps, setSteps] = useState(initial.steps);
  const [source, setSource] = useState(initial.source ?? "");
  const [link, setLink] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function importFromLink() {
    const url = link.trim();
    if (!url) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await fetch("/api/recipe-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<Imported> & { error?: string };
      if (!res.ok) throw new Error(data.error || "Import failed.");
      const ing = data.ingredients ?? [];
      const st = data.steps ?? [];
      if (data.name) setName(data.name);
      setIngredients(ing.join("\n"));
      setSteps(st.join("\n"));
      setSource(data.source ?? url);
      setLink("");
      setImportMsg({
        ok: true,
        text: `Imported ${ing.length} ingredient${ing.length === 1 ? "" : "s"} and ${st.length} step${st.length === 1 ? "" : "s"}. Review, then save.`,
      });
    } catch (e) {
      setImportMsg({ ok: false, text: (e as Error).message });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--surface-border)", borderRadius: 6, padding: 14, marginBottom: 12 }}>
      <p style={labelStyle}>Import from a link</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") importFromLink();
          }}
          placeholder="Paste a recipe link (https://…)"
          inputMode="url"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button style={primaryBtn} disabled={importing || !link.trim()} onClick={importFromLink}>
          {importing ? "Importing…" : "Import"}
        </button>
      </div>
      {importMsg && (
        <p style={{ ...dimText, fontSize: 12, marginTop: 6, color: importMsg.ok ? "#8fbf7f" : "#e88" }}>{importMsg.text}</p>
      )}

      <p style={{ ...labelStyle, marginTop: 14 }}>Or type it in</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Recipe name" style={inputStyle} />
      <textarea
        value={ingredients}
        onChange={(e) => setIngredients(e.target.value)}
        placeholder={"Ingredients (one per line)\n2 lb chicken thighs\n1 cup rice"}
        rows={6}
        style={{ ...inputStyle, marginTop: 10, resize: "vertical" }}
      />
      <textarea
        value={steps}
        onChange={(e) => setSteps(e.target.value)}
        placeholder={"Steps (one per line)\nPreheat oven to 425°F\nSeason chicken..."}
        rows={6}
        style={{ ...inputStyle, marginTop: 10, resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          style={primaryBtn}
          disabled={saving || importing || name.trim().length === 0}
          onClick={() => onSubmit({ ...initial, name: name.trim(), ingredients, steps, ...(source ? { source } : {}) })}
        >
          {saving ? "Saving…" : "Save recipe"}
        </button>
        <button style={ghostBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "original";
  }
}

function Recipes({
  recipes,
  editable,
  save,
  saving,
}: {
  recipes: Recipe[];
  editable: boolean;
  save: (next: Recipe[]) => Promise<boolean>;
  saving: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <>
      {editable && !adding && (
        <button style={{ ...linkBtn, marginBottom: 12 }} onClick={() => setAdding(true)}>
          + Add recipe
        </button>
      )}
      {adding && (
        <RecipeForm
          initial={{ id: newId(), name: "", ingredients: "", steps: "" }}
          saving={saving}
          onCancel={() => setAdding(false)}
          onSubmit={async (r) => {
            if (await save([r, ...recipes])) setAdding(false);
          }}
        />
      )}

      {recipes.length === 0 && !adding && (
        <p style={dimText}>{editable ? "No recipes yet. Add your first one." : "No recipes yet."}</p>
      )}

      {recipes.map((r, i) =>
        editingId === r.id ? (
          <RecipeForm
            key={r.id}
            initial={r}
            saving={saving}
            onCancel={() => setEditingId(null)}
            onSubmit={async (next) => {
              if (await save(recipes.map((x) => (x.id === r.id ? next : x)))) setEditingId(null);
            }}
          />
        ) : (
          <div key={r.id} style={{ padding: "12px 0", borderTop: i === 0 ? "none" : "1px solid var(--surface-border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <button
                onClick={() => setOpenId(openId === r.id ? null : r.id)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", color: "var(--text)", fontFamily: sans, fontSize: 15, fontWeight: 600 }}
              >
                {openId === r.id ? "▾ " : "▸ "}
                {r.name}
              </button>
              {editable && (
                <span style={{ display: "flex", gap: 12, flexShrink: 0 }}>
                  <button style={linkBtn} onClick={() => setEditingId(r.id)}>
                    Edit
                  </button>
                  <button
                    style={{ ...linkBtn, color: "#e88" }}
                    onClick={() => {
                      if (window.confirm(`Delete "${r.name}"?`)) save(recipes.filter((x) => x.id !== r.id));
                    }}
                  >
                    Delete
                  </button>
                </span>
              )}
            </div>
            {openId === r.id && (
              <div style={{ marginTop: 10, paddingLeft: 16 }}>
                {r.source && (
                  <a
                    href={r.source}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontFamily: mono, fontSize: 12, display: "inline-block", marginBottom: 10 }}
                  >
                    View on {hostOf(r.source)} ↗
                  </a>
                )}
                {lines(r.ingredients).length > 0 && (
                  <>
                    <p style={labelStyle}>Ingredients</p>
                    <ul style={{ ...dimText, paddingLeft: 18, margin: "0 0 10px 0" }}>
                      {lines(r.ingredients).map((l, idx) => (
                        <li key={idx}>{l}</li>
                      ))}
                    </ul>
                  </>
                )}
                {lines(r.steps).length > 0 && (
                  <>
                    <p style={labelStyle}>Steps</p>
                    <ol style={{ ...dimText, paddingLeft: 18, margin: 0 }}>
                      {lines(r.steps).map((l, idx) => (
                        <li key={idx} style={{ marginBottom: 4 }}>
                          {l}
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </div>
            )}
          </div>
        )
      )}
    </>
  );
}

// ---------- To-do ----------

function Todos({
  todos,
  editable,
  save,
  saving,
}: {
  todos: Todo[];
  editable: boolean;
  save: (next: Todo[]) => Promise<boolean>;
  saving: boolean;
}) {
  const [text, setText] = useState("");
  const doneCount = todos.filter((t) => t.done).length;

  async function add() {
    const t = text.trim();
    if (!t) return;
    if (await save([...todos, { id: newId(), text: t, done: false }])) setText("");
  }

  return (
    <>
      {editable && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder="Add a to-do (e.g. buy chicken thighs, thaw enchiladas)"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button style={primaryBtn} disabled={saving || !text.trim()} onClick={add}>
            Add
          </button>
        </div>
      )}

      {todos.length === 0 && <p style={dimText}>Nothing on the list.</p>}

      {todos.map((t, i) => (
        <div
          key={t.id}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: i === 0 ? "none" : "1px solid var(--surface-border)" }}
        >
          <input
            type="checkbox"
            checked={t.done}
            disabled={!editable || saving}
            onChange={() => save(todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}
            style={{ width: 16, height: 16, cursor: editable ? "pointer" : "default" }}
          />
          <span
            style={{
              flex: 1,
              fontFamily: sans,
              fontSize: 14,
              color: t.done ? "var(--text-dim)" : "var(--text)",
              textDecoration: t.done ? "line-through" : "none",
            }}
          >
            {t.text}
          </span>
          {editable && (
            <button
              aria-label="Remove"
              style={{ ...linkBtn, color: "var(--text-dim)", fontSize: 16 }}
              onClick={() => save(todos.filter((x) => x.id !== t.id))}
            >
              ×
            </button>
          )}
        </div>
      ))}

      {editable && doneCount > 0 && (
        <button style={{ ...linkBtn, marginTop: 12 }} onClick={() => save(todos.filter((x) => !x.done))}>
          Clear {doneCount} completed
        </button>
      )}
    </>
  );
}

// ---------- Main ----------

type Section = "Meal plan" | "Recipes" | "To-do";

export default function FoodTab({
  data,
  editable,
  onSave,
}: {
  data: FoodContent;
  editable: boolean;
  onSave: (next: FoodContent) => Promise<void>;
}) {
  const [section, setSection] = useState<Section>("Meal plan");
  const [local, setLocal] = useState<FoodContent>(data);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocal(data);
  }, [data]);

  const plan = local.plan ?? DEFAULT_PLAN;

  async function persist(next: FoodContent): Promise<boolean> {
    const prev = local;
    setLocal(next);
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      return true;
    } catch (e) {
      setLocal(prev);
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {(["Meal plan", "Recipes", "To-do"] as const).map((s) => (
          <Pill
            key={s}
            label={s === "Recipes" ? `Recipes (${local.recipes.length})` : s === "To-do" ? `To-do (${local.todos.filter((t) => !t.done).length})` : s}
            on={s === section}
            onClick={() => setSection(s)}
          />
        ))}
      </div>

      {section === "Meal plan" && (
        <MealPlan
          plan={plan}
          recipes={local.recipes}
          editable={editable}
          saving={saving}
          onSavePlan={(nextPlan) => persist({ ...local, plan: nextPlan })}
          onSaveRecipeFromSlot={(kind, index) => {
            const m = plan[kind][index];
            const r: Recipe = { id: newId(), name: m.name, ingredients: m.ingredients ?? "", steps: m.steps ?? "", ...(m.source ? { source: m.source } : {}) };
            const nextPlan = { ...plan, [kind]: plan[kind].map((x, j) => (j === index ? { ...x, recipeId: r.id } : x)) };
            return persist({ ...local, recipes: [r, ...local.recipes], plan: nextPlan });
          }}
        />
      )}
      {section === "Recipes" && (
        <Recipes recipes={local.recipes} editable={editable} saving={saving} save={(recipes) => persist({ ...local, recipes })} />
      )}
      {section === "To-do" && (
        <Todos todos={local.todos} editable={editable} saving={saving} save={(todos) => persist({ ...local, todos })} />
      )}

      {!editable && section !== "Meal plan" && (
        <p style={{ ...dimText, fontSize: 12, marginTop: 16 }}>Sign in with edit access to add or change items.</p>
      )}
      {error && <p style={errorStyle}>{error}</p>}
    </div>
  );
}
