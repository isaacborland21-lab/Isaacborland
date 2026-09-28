import { createClient } from "@supabase/supabase-js";

// Server-only client using the service role key, which bypasses row level
// security entirely. NEVER import this file from a "use client" component
// or otherwise let it reach the browser bundle — it belongs in API routes
// only.
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase server environment variables are not configured.");
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export const VALID_TABS = ["home", "projects", "food", "about", "contact"] as const;
export type ValidTab = (typeof VALID_TABS)[number];

export function isValidTab(tab: string): tab is ValidTab {
  return (VALID_TABS as readonly string[]).includes(tab);
}

export type PublicMetadata = {
  owner?: boolean;
  tabAdmin?: Partial<Record<ValidTab, boolean>>;
};

// Applied automatically to every new sign-up (see
// app/api/webhooks/clerk/route.ts) so a brand-new, invite-only user can
// immediately edit the lowest-stakes, most self-descriptive tabs without
// the owner having to grant access by hand. Home and Projects are
// deliberately left out — those stay owner-only until explicitly granted.
// Food is also owner-only by default — it's Isaac's personal recipe box.
export const DEFAULT_TAB_ADMIN: Partial<Record<ValidTab, boolean>> = {
  about: true,
  contact: true,
};

export function canEditTab(metadata: PublicMetadata | null | undefined, tab: ValidTab): boolean {
  if (!metadata) return false;
  if (metadata.owner === true) return true;
  return metadata.tabAdmin?.[tab] === true;
}
