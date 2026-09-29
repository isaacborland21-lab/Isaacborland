// Shared project model for the Projects tab (used by the page and the
// suggestions API). Older saved projects were just { name, status };
// normalizeProjects() upgrades them in place without losing anything.

export type ProjectLink = { label: string; url: string };
export type ProjectUpdate = { id: string; date: string; text: string };

export type Project = {
  id: string;
  name: string;
  status: string;
  summary: string;
  description: string;
  progress: number; // 0-100
  links: ProjectLink[];
  updates: ProjectUpdate[]; // newest first
  createdAt?: string;
  suggestedBy?: string;
};

export const PROJECT_STATUSES = ["idea", "planned", "in progress", "paused", "done"];

export function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Readable, link-friendly id for a new project: "gmail-cleanup-k3f9".
// The short random tail keeps it unique if two projects share a name.
// The id never changes after creation, so renaming a project keeps its link.
export function projectId(name: string) {
  const tail = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `${slug(name) || "project"}-${tail}`;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function normalizeProjects(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((item, index): Project[] => {
    if (!item || typeof item !== "object") return [];
    const o = item as Record<string, unknown>;
    const name = str(o.name).trim();
    if (!name) return [];
    // Old projects have no id: derive a stable one from the name so the
    // same project keeps the same id until it's saved with a real one.
    let id = str(o.id).trim() || `p-${slug(name) || "project"}-${index}`;
    if (seen.has(id)) id = `${id}-${index}`;
    seen.add(id);

    const progressNum = Number(o.progress);
    const links = Array.isArray(o.links)
      ? o.links.flatMap((l): ProjectLink[] => {
          if (!l || typeof l !== "object") return [];
          const r = l as Record<string, unknown>;
          const url = str(r.url).trim();
          return url ? [{ label: str(r.label).trim() || url, url }] : [];
        })
      : [];
    const updates = Array.isArray(o.updates)
      ? o.updates.flatMap((u, i): ProjectUpdate[] => {
          if (!u || typeof u !== "object") return [];
          const r = u as Record<string, unknown>;
          const text = str(r.text).trim();
          return text ? [{ id: str(r.id) || `u-${i}`, date: str(r.date) || "", text }] : [];
        })
      : [];

    return [
      {
        id,
        name,
        status: str(o.status, "idea").trim() || "idea",
        summary: str(o.summary),
        description: str(o.description),
        progress: Number.isFinite(progressNum) ? Math.min(100, Math.max(0, Math.round(progressNum))) : 0,
        links,
        updates,
        ...(str(o.createdAt) ? { createdAt: str(o.createdAt) } : {}),
        ...(str(o.suggestedBy) ? { suggestedBy: str(o.suggestedBy) } : {}),
      },
    ];
  });
}

// Only http(s) links are allowed, so a saved link can never run script.
// "github.com/me" is accepted and becomes "https://github.com/me".
export function safeUrl(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
