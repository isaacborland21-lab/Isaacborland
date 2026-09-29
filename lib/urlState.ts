// Keeps the open tab (and open project) in the address bar so the browser's
// back/forward buttons work and any view can be linked to directly:
//   /                                   -> Home
//   /?tab=food                          -> Food
//   /?tab=projects&project=gmail-cleanup -> that project's page
//
// Uses the History API directly instead of Next's router so the page
// stays one client component (no Suspense boundary or re-fetch needed).

export type UrlState = { tab: string | null; project: string | null };

export function readUrl(): UrlState {
  if (typeof window === "undefined") return { tab: null, project: null };
  const p = new URLSearchParams(window.location.search);
  const tab = p.get("tab")?.trim().toLowerCase() || null;
  const project = p.get("project")?.trim() || null;
  return { tab, project };
}

export function hrefFor(state: UrlState): string {
  const p = new URLSearchParams();
  const tab = state.tab?.toLowerCase();
  if (tab && tab !== "home") p.set("tab", tab);
  if (state.project && tab === "projects") p.set("project", state.project);
  const qs = p.toString();
  // Everything lives on the home route, so links are always "/?...".
  return qs ? `/?${qs}` : "/";
}

// push: a new history entry (back button returns here).
// replace: rewrite the current entry (e.g. after deleting what was open).
export function writeUrl(state: UrlState, mode: "push" | "replace" = "push") {
  const href = hrefFor(state);
  const current = `${window.location.pathname}${window.location.search}`;
  if (href === current) return;
  if (mode === "replace") window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
}

export function absoluteUrl(state: UrlState): string {
  return `${window.location.origin}${hrefFor(state)}`;
}
