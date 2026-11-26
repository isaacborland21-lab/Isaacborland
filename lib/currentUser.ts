import { auth, clerkClient } from "@clerk/nextjs/server";
import type { PublicMetadata } from "@/lib/supabaseAdmin";

// Server-only. Who is making this request: their account id, their switches (public metadata) and their name.
//
// Why this exists: the crew API routes used to ask Clerk's servers for the whole user on EVERY request, photos
// included. A list with dozens of photos fired dozens of lookups at once and Clerk answered "Too Many Requests",
// so photos failed to load.
//
// Now the answer comes from the signed session token the browser already sends, with no call to Clerk at all.
// That needs the session token to carry the metadata and the name (Clerk dashboard -> Sessions -> Customize
// session token), with exactly this JSON:
//   { "metadata": "{{user.public_metadata}}", "firstName": "{{user.first_name}}", "lastName": "{{user.last_name}}", "username": "{{user.username}}" }
// Until that is set, it falls back to asking Clerk, but at most once a minute per person on each server
// instance, and requests that arrive together share one lookup.
//
// A role change in the Admin tab reaches the token when it next refreshes (about a minute).

export type Me = { userId: string; meta: PublicMetadata; name: string };

type Named = { firstName: string | null; lastName: string | null; username: string | null };

/** First + last name, else username, else "Crew" (the same rule as before). */
export function nameOf(u: Named): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.username || "Crew";
  return name.slice(0, 80);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** The metadata and name from the session token, or null when the token has not been set up to carry them. */
export function fromClaims(claims: Record<string, unknown> | null | undefined): Pick<Me, "meta" | "name"> | null {
  if (!claims) return null;
  const meta = claims.metadata;
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return null;
  // the name fields must be in the token too (their values may be empty), or names would all read "Crew"
  if (!("firstName" in claims) && !("username" in claims)) return null;
  return {
    meta: meta as PublicMetadata,
    name: nameOf({ firstName: str(claims.firstName), lastName: str(claims.lastName), username: str(claims.username) }),
  };
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Pick<Me, "meta" | "name"> }>();
const inFlight = new Map<string, Promise<Pick<Me, "meta" | "name">>>();

async function fromClerk(userId: string): Promise<Pick<Me, "meta" | "name">> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const pending = inFlight.get(userId);
  if (pending) return pending;
  const p = (async () => {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const value = { meta: (user.publicMetadata ?? {}) as PublicMetadata, name: nameOf(user) };
    cache.set(userId, { at: Date.now(), value });
    if (cache.size > 500) cache.delete(cache.keys().next().value as string); // keep the cache small
    return value;
  })();
  inFlight.set(userId, p);
  try {
    return await p;
  } finally {
    inFlight.delete(userId);
  }
}

/** The signed-in person, or null when nobody is signed in. */
export async function currentUser(): Promise<Me | null> {
  const { userId, sessionClaims } = auth();
  if (!userId) return null;
  const quick = fromClaims(sessionClaims as Record<string, unknown> | null | undefined);
  if (quick) return { userId, ...quick };
  return { userId, ...(await fromClerk(userId)) };
}
