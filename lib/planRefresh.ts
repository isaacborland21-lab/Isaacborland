// Builds a refreshed week for the Food tab's "Refresh week" button.
// Pure logic (no fetching) so it can be tested on its own.

import { Batch, MealPlanData, PlanMeal } from "@/app/foodDefaults";

export type RefreshMode = "mix" | "mine" | "web";
export type MealKind = "lunch" | "dinner";
export type StoredRecipe = { id: string; name: string };
export type WebIdea = { name: string; ingredients: string[]; steps: string[]; source: string };

type Slot = { kind: MealKind; index: number };

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Mon-Wed come from Sunday prep, Thu-Sun from Wednesday prep. Sunday is
// 4 days after Wednesday, so it gets frozen and thawed the night before.
export function prepFor(dayIndex: number): { batch: Batch; note: string } {
  if (dayIndex <= 2) return { batch: "Sunday prep", note: "Cook Sunday." };
  if (dayIndex <= 5) return { batch: "Wednesday prep", note: "Cook Wednesday." };
  return { batch: "Wednesday prep", note: "Cook Wednesday, freeze, thaw Saturday night." };
}

export function openSlots(plan: MealPlanData, kinds: MealKind[]): Slot[] {
  return kinds.flatMap((kind) =>
    plan[kind].flatMap((m, index) => (m.locked ? [] : [{ kind, index }]))
  );
}

// How many days come from saved recipes vs. the web.
export function splitCounts(slotCount: number, recipeCount: number, mode: RefreshMode) {
  const nMine =
    mode === "web" ? 0 : mode === "mine" ? Math.min(slotCount, recipeCount) : Math.min(Math.ceil(slotCount / 2), recipeCount);
  const nWeb = mode === "mine" ? 0 : slotCount - nMine;
  return { nMine, nWeb };
}

export function buildRefreshedPlan(
  plan: MealPlanData,
  kinds: MealKind[],
  mode: RefreshMode,
  recipes: StoredRecipe[],
  web: WebIdea[]
): { plan: MealPlanData; notes: string[] } {
  const slots = shuffle(openSlots(plan, kinds));
  const { nMine, nWeb } = splitCounts(slots.length, recipes.length, mode);

  type Source = { kind: "mine"; recipe: StoredRecipe } | { kind: "web"; idea: WebIdea };
  const sources: Source[] = shuffle([
    ...shuffle(recipes).slice(0, nMine).map((recipe): Source => ({ kind: "mine", recipe })),
    ...web.slice(0, nWeb).map((idea): Source => ({ kind: "web", idea })),
  ]);

  const next: MealPlanData = { lunch: [...plan.lunch], dinner: [...plan.dinner] };
  slots.forEach((slot, i) => {
    const src = sources[i];
    if (!src) return; // not enough ideas: this day stays as it was
    const old = next[slot.kind][slot.index];
    const { batch, note } = prepFor(slot.index);
    const meal: PlanMeal =
      src.kind === "mine"
        ? { day: old.day, name: src.recipe.name, note, batch, recipeId: src.recipe.id }
        : {
            day: old.day,
            name: src.idea.name,
            note,
            batch,
            ingredients: src.idea.ingredients.join("\n"),
            steps: src.idea.steps.join("\n"),
            source: src.idea.source,
          };
    next[slot.kind][slot.index] = meal;
  });

  const notes: string[] = [];
  const unfilled = slots.length - Math.min(slots.length, sources.length);
  if (slots.length === 0) notes.push("Every day is locked, so there was nothing to refresh.");
  else if (unfilled > 0) {
    if (mode === "mine") {
      notes.push(
        `You have ${recipes.length} saved recipe${recipes.length === 1 ? "" : "s"}, so ${unfilled} day${unfilled === 1 ? "" : "s"} kept ${unfilled === 1 ? "its" : "their"} old meal. Add more recipes or use "Mine + web".`
      );
    } else {
      notes.push(`Only found ${web.length} new idea${web.length === 1 ? "" : "s"} online, so ${unfilled} day${unfilled === 1 ? "" : "s"} kept ${unfilled === 1 ? "its" : "their"} old meal.`);
    }
  }
  return { plan: next, notes };
}
