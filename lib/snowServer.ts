import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { PublicMetadata } from "@/lib/supabaseAdmin";
import { Db, displayName, fail } from "@/lib/graffitiServer";
import { MAX_ROUTE_BYTES, ROUTES_FILE, SNOW_BUCKET, SnowRoute, canUseSnow, parseRoutes } from "@/lib/snow";

// Server-only helpers for the Snow removal API routes. Never import from a client component.
// Route PDFs live in their own private bucket ("snow"), which is created automatically the first time
// the owner uploads a route, so there is no SQL to run for this feature.

export type SnowWho = { userId: string; owner: boolean; name: string };

/** Signed in AND allowed on the Snow removal tab. With `ownerOnly`, only the site owner passes (adding / changing routes). */
export async function requireSnow(ownerOnly = false): Promise<SnowWho | NextResponse> {
  const { userId } = auth();
  if (!userId) return fail("Not signed in.", 401);
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const meta = user.publicMetadata as PublicMetadata;
  const owner = meta.owner === true;
  if (ownerOnly ? !owner : !canUseSnow(meta)) {
    return fail(ownerOnly ? "Only Isaac can change the snow routes." : "Not permitted to see the snow routes.", 403);
  }
  return { userId, owner, name: displayName(user) };
}

/** Makes the private "snow" bucket if it isn't there yet (PDFs plus the routes list, nothing else). */
export async function ensureSnowBucket(db: Db): Promise<string | null> {
  const { data } = await db.storage.getBucket(SNOW_BUCKET);
  if (data) return null;
  const { error } = await db.storage.createBucket(SNOW_BUCKET, {
    public: false,
    fileSizeLimit: MAX_ROUTE_BYTES,
    allowedMimeTypes: ["application/pdf", "application/json"],
  });
  if (error && !/already exists/i.test(error.message)) return `Could not set up storage for the routes: ${error.message}`;
  return null;
}

/** The current list of routes. A missing bucket or file just means there are no routes yet. */
export async function loadRoutes(db: Db): Promise<SnowRoute[]> {
  const { data, error } = await db.storage.from(SNOW_BUCKET).download(ROUTES_FILE);
  if (error || !data) return [];
  try {
    return parseRoutes(JSON.parse(await data.text()));
  } catch {
    return [];
  }
}

export async function saveRoutes(db: Db, routes: SnowRoute[]): Promise<string | null> {
  const body = new Blob([JSON.stringify({ version: 1, routes }, null, 1)], { type: "application/json" });
  const { error } = await db.storage.from(SNOW_BUCKET).upload(ROUTES_FILE, body, {
    contentType: "application/json",
    upsert: true,
    cacheControl: "0",
  });
  return error ? `Could not save the route list: ${error.message}` : null;
}

export const noStore = { "Cache-Control": "no-store" };
