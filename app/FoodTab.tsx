"use client";

import { useEffect, useState } from "react";

const mono = "'IBM Plex Mono', monospace";
const sans = "'IBM Plex Sans', sans-serif";

// ---------- Types ----------

export type Recipe = { id: string; name: string; ingredients: string; steps: string; source?: string };
export type Todo = { id: string; text: string; done: boolean };
export type FoodContent = { recipes: Recipe[]; todos: Todo[] };

type Batch = "Sunday prep" | "Wednesday prep";
type Meal = { day: string; name: string; note: string; batch: Batch };

// ---------- Static meal plan ----------
// Sunday prep covers Mon-Wed. Wednesday prep covers Thu-Sun.
// Anything eaten 4 days after its prep day gets frozen, then thawed the night before.

const lunches: Meal[] = [
  { day: "Mon", name: "Cilantro-lime chicken burrito bowls", note: "Rice, black beans, corn salsa, chicken.", batch: "Sunday prep" },
  { day: "Tue", name: "Greek chicken quinoa bowls", note: "Cucumber, tomato, feta. Tzatziki on the side so it stays crisp.", batch: "Sunday prep" },
  { day: "Wed", name: "Beef & broccoli with rice", note: "Keep the sauce thick so the rice doesn't go soggy.", batch: "Sunday prep" },
  { day: "Thu", name: "Pesto chicken pasta salad", note: "Eat cold. Cherry tomatoes, mozzarella, spinach.", batch: "Wednesday prep" },
  { day: "Fri", name: "Peanut chicken noodles", note: "Rice noodles, shredded carrot, cabbage. Cold or warm.", batch: "Wednesday prep" },
  { day: "Sat", name: "Turkey chili", note: "Big pot. Freeze the extra portions for next week.", batch: "Wednesday prep" },
  { day: "Sun", name: "BBQ pulled pork sweet potato bowls", note: "Freeze Wednesday, move to fridge Saturday night.", batch: "Wednesday prep" },
];

const dinners: Meal[] = [
  { day: "Mon", name: "Sheet-pan sausage, peppers & potatoes", note: "One pan, 35 min. Portion into containers.", batch: "Sunday prep" },
  { day: "Tue", name: "Slow-cooker chicken tikka masala", note: "Serve over rice. Better on day 2.", batch: "Sunday prep" },
  { day: "Wed", name: "Baked ziti", note: "Assemble Sunday, keep unbaked in the fridge, bake Wednesday night.", batch: "Sunday prep" },
  { day: "Thu", name: "Honey-garlic chicken & green beans", note: "Cook Wednesday, reheats well. Serve with rice.", batch: "Wednesday prep" },
  { day: "Fri", name: "Steak fajitas", note: "Slice peppers & onions, marinate steak Wednesday. 15 min to cook Friday.", batch: "Wednesday prep" },
  { day: "Sat", name: "Shepherd's pie", note: "Assemble Wednesday, bake Saturday.", batch: "Wednesday prep" },
  { day: "Sun", name: "Chicken enchiladas", note: "Assemble & freeze Wednesday. Thaw Saturday night, bake Sunday.", batch: "Wednesday prep" },
];

const batchColor: Record<Batch, string> = {
  "Sunday prep": "var(--accent)",
  "Wednesday prep": "#7fb3d5",
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

// ---------- Meal plan ----------

function MealPlan() {
  const [view, setView] = useState<"Lunch" | "Dinner">("Lunch");
  const meals = view === "Lunch" ? lunches : dinners;

  return (
    <>
      <p style={{ ...dimText, fontSize: 14, marginBottom: 16 }}>
        Two prep sessions: <strong>Sunday</strong> covers Mon–Wed, <strong>Wednesday</strong> covers Thu–Sun. Cooked food
        holds 3–4 days in the fridge, so anything eaten 4 days out gets frozen and thawed the night before.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["Lunch", "Dinner"] as const).map((v) => (
          <Pill key={v} label={v} on={v === view} onClick={() => setView(v)} />
        ))}
      </div>
      {meals.map((m, i) => (
        <div
          key={m.day}
          style={{ display: "flex", gap: 14, padding: "14px 0", borderTop: i === 0 ? "none" : "1px solid var(--surface-border)" }}
        >
          <span style={{ fontFamily: mono, fontSize: 12, color: "var(--accent)", width: 32, flexShrink: 0, paddingTop: 2 }}>{m.day}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
              <span style={{ fontFamily: sans, fontSize: 15, fontWeight: 600 }}>{m.name}</span>
              <span style={{ fontFamily: mono, fontSize: 10, color: batchColor[m.batch], textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {m.batch}
              </span>
            </div>
            <p style={{ ...dimText, marginTop: 4 }}>{m.note}</p>
          </div>
        </div>
      ))}
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
          onClick={() =>
            onSubmit({ ...initial, name: name.trim(), ingredients, steps, ...(source ? { source } : {}) })
          }
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

function lines(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
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
    <div style={{ border: "1px solid var(--surface-border)", background: "var(--surface)", borderRadius: 6, padding: "24px" }}>
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

      {section === "Meal plan" && <MealPlan />}
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
