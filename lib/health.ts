// Shared shape for the room dashboard's Apple Health snapshot.
//
// Numerators (steps, move/exercise/stand totals) come from Isaac's phone
// via /api/health/ingest, on whatever schedule his Shortcuts automation
// runs. Goals never come from the phone — Shortcuts has no access to
// HealthKit's Activity Summary type, which is the only place ring goals
// live, so they're set here on the dashboard instead (see /api/health/goals)
// and simply don't change often.

export type HealthGoals = {
  move_kcal: number;
  exercise_min: number;
  stand_hours: number;
};

export type HealthMetrics = {
  steps: number | null;
  move_kcal: number | null;
  exercise_min: number | null;
  stand_hours: number | null;
  sample_date: string | null; // the device-local date (YYYY-MM-DD) these totals are for
  goals: HealthGoals;
};

export const DEFAULT_GOALS: HealthGoals = {
  move_kcal: 450,
  exercise_min: 30,
  stand_hours: 12,
};

export function emptyMetrics(): HealthMetrics {
  return {
    steps: null,
    move_kcal: null,
    exercise_min: null,
    stand_hours: null,
    sample_date: null,
    goals: DEFAULT_GOALS,
  };
}

// Pulls a numerator out of whatever shape got POSTed to /api/health/ingest.
//
// Isaac's own Shortcut sends the simple flat shape documented in
// /api/health/ingest/route.ts. This also does a best-effort read of Health
// Auto Export's REST export shape (a top-level "data.metrics" array of
// {name, units, data: [{date, qty}]}), in case he ever switches to that app
// instead — untested against a real payload, since HAE doesn't publish an
// exact schema, so it's deliberately forgiving: it matches metric names
// loosely and won't throw if the shape doesn't match what it expects.
export function extractIngestFields(body: unknown): {
  steps?: number;
  move_kcal?: number;
  exercise_min?: number;
  stand_hours?: number;
  sample_date?: string;
} {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

  // Simple flat shape (what the Shortcuts automation sends).
  const flat = {
    steps: num(b.steps),
    move_kcal: num(b.move_kcal ?? b.move),
    exercise_min: num(b.exercise_min ?? b.exercise),
    stand_hours: num(b.stand_hours ?? b.stand),
    sample_date: str(b.date ?? b.sample_date),
  };
  if (Object.values(flat).some((v) => v !== undefined)) {
    return flat;
  }

  // Best-effort Health Auto Export shape: data.metrics[{name, data:[{date,qty}]}]
  const data = b.data as { metrics?: unknown } | undefined;
  const metrics = Array.isArray(data?.metrics) ? (data!.metrics as Record<string, unknown>[]) : null;
  if (!metrics) return {};

  const sumOrLast = (name: RegExp, mode: "sum" | "last"): number | undefined => {
    const m = metrics.find((entry) => typeof entry.name === "string" && name.test(entry.name as string));
    const points = Array.isArray(m?.data) ? (m!.data as Record<string, unknown>[]) : null;
    if (!points || points.length === 0) return undefined;
    const values = points.map((p) => num(p.qty ?? p.value)).filter((v): v is number => v !== undefined);
    if (values.length === 0) return undefined;
    return mode === "sum" ? values.reduce((a, c) => a + c, 0) : values[values.length - 1];
  };

  return {
    steps: sumOrLast(/step/i, "sum"),
    move_kcal: sumOrLast(/active_energy|move/i, "sum"),
    exercise_min: sumOrLast(/exercise/i, "sum"),
    stand_hours: sumOrLast(/stand/i, "sum"),
  };
}
