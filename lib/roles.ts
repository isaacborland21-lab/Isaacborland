// Role presets for the Admin tab. A role is a one-click bundle of the job-related switches; the
// individual checkboxes stay for fine-tuning. Pure and client-safe (no server imports).

/** The switches a role controls. Everything else (home, projects, food, about, contact) is left alone. */
export const ROLE_KEYS = ["graffiti", "workorders", "lawn", "otherjobs", "invoice"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLES = ["none", "graffiti_crew", "jobs_crew", "manager"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  none: "No job access",
  graffiti_crew: "Graffiti crew",
  jobs_crew: "Jobs crew (work orders, lawn, other jobs)",
  manager: "Manager (all job tabs + invoice)",
};

export const ROLE_GRANTS: Record<Role, readonly RoleKey[]> = {
  none: [],
  graffiti_crew: ["graffiti"],
  jobs_crew: ["workorders", "lawn", "otherjobs"],
  manager: ["graffiti", "workorders", "lawn", "otherjobs", "invoice"],
};

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

type Flags = Partial<Record<string, boolean>>;

/** `tabAdmin` with the role's switches set (on for the ones it grants, off for the rest of ROLE_KEYS). Other keys are kept as they were. */
export function applyRole<T extends Flags>(tabAdmin: T | null | undefined, role: Role): T {
  const next: Flags = { ...(tabAdmin ?? {}) };
  for (const k of ROLE_KEYS) next[k] = ROLE_GRANTS[role].includes(k);
  return next as T;
}

/** Which role the current switches add up to exactly, or "custom" when they match none of them. */
export function roleOf(tabAdmin: Flags | null | undefined): Role | "custom" {
  const on = ROLE_KEYS.filter((k) => tabAdmin?.[k] === true);
  for (const r of ROLES) {
    const g = ROLE_GRANTS[r];
    if (g.length === on.length && g.every((k) => on.includes(k))) return r;
  }
  return "custom";
}
