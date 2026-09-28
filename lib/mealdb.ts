// Pulls meal ideas from TheMealDB (https://www.themealdb.com), a free public
// recipe database. Server-side only (used by /api/meal-ideas).

const BASE = "https://www.themealdb.com/api/json/v1/1";

// Main-course categories that hold up for meal prep. Desserts, breakfast,
// sides and starters are left out on purpose.
export const PREP_CATEGORIES = ["Chicken", "Beef", "Pork", "Pasta", "Lamb", "Seafood", "Vegetarian"];

export type WebMeal = {
  id: string;
  name: string;
  category: string;
  ingredients: string[];
  steps: string[];
  source: string;
};

type Raw = Record<string, string | null | undefined>;

async function getJson(url: string): Promise<{ meals: Raw[] | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`Recipe source returned ${res.status}`);
    return (await res.json()) as { meals: Raw[] | null };
  } finally {
    clearTimeout(timer);
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function parseMeal(m: Raw, category = ""): WebMeal | null {
  const id = (m.idMeal ?? "").trim();
  const name = (m.strMeal ?? "").trim();
  if (!id || !name) return null;

  const ingredients: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const ing = (m[`strIngredient${i}`] ?? "").trim();
    if (!ing) continue;
    const measure = (m[`strMeasure${i}`] ?? "").trim();
    ingredients.push(measure ? `${measure} ${ing}` : ing);
  }

  const steps = (m.strInstructions ?? "")
    .split(/\r?\n+/)
    .map((s) => s.replace(/^\s*(step\s*\d+[:.)]?|\d+[.)])\s*/i, "").trim())
    .filter((s) => s.length > 2);

  const source = (m.strSource ?? "").trim() || `https://www.themealdb.com/meal/${id}`;
  return { id, name, category: (m.strCategory ?? category).trim(), ingredients, steps, source };
}

// Picks `count` random main-course meals, skipping any whose name is in `exclude`.
export async function randomPrepMeals(count: number, exclude: string[]): Promise<WebMeal[]> {
  const skip = new Set(exclude.map((n) => n.trim().toLowerCase()));

  const lists = await Promise.allSettled(
    PREP_CATEGORIES.map(async (c) => {
      const data = await getJson(`${BASE}/filter.php?c=${encodeURIComponent(c)}`);
      return (data.meals ?? []).map((m) => ({ id: m.idMeal ?? "", name: m.strMeal ?? "", category: c }));
    })
  );
  const pool = lists.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (pool.length === 0) throw new Error("Couldn't reach the recipe database. Try again in a minute.");

  // Spread picks across categories so a week isn't seven chicken dishes.
  const byCategory = new Map<string, typeof pool>();
  for (const p of shuffle(pool)) {
    if (!p.id || !p.name || skip.has(p.name.trim().toLowerCase())) continue;
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }
  const picks: typeof pool = [];
  const cats = shuffle(Array.from(byCategory.keys()));
  let round = 0;
  while (picks.length < count && cats.some((c) => (byCategory.get(c) ?? []).length > round)) {
    for (const c of cats) {
      const item = (byCategory.get(c) ?? [])[round];
      if (item && picks.length < count) picks.push(item);
    }
    round++;
  }

  const details = await Promise.allSettled(
    picks.map(async (p) => {
      const data = await getJson(`${BASE}/lookup.php?i=${encodeURIComponent(p.id)}`);
      const raw = data.meals?.[0];
      return raw ? parseMeal(raw, p.category) : null;
    })
  );
  return details.flatMap((r) => (r.status === "fulfilled" && r.value && r.value.ingredients.length > 0 ? [r.value] : []));
}
