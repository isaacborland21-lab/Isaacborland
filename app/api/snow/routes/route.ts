import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fail, isResponse } from "@/lib/graffitiServer";
import { MAX_ROUTES, MAX_ROUTE_BYTES, ROUTE_ID_RE, SNOW_BUCKET, cleanName, routePath, sortRoutes } from "@/lib/snow";
import { ensureSnowBucket, loadRoutes, noStore, requireSnow } from "@/lib/snowServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Every route (crew and owner). */
export async function GET() {
  const who = await requireSnow();
  if (isResponse(who)) return who;
  const routes = sortRoutes(await loadRoutes(getSupabaseAdmin()));
  return NextResponse.json({ routes, owner: who.owner }, { headers: noStore });
}

/**
 * Owner: step 1 of adding (or replacing) a route. Route PDFs can be far bigger than a web request is allowed
 * to carry, so the browser uploads the file straight to storage with this one-time link, then confirms it with
 * PUT /api/snow/routes/<id> (which checks the file really is a PDF before it shows up for anyone).
 */
export async function POST(request: Request) {
  const who = await requireSnow(true);
  if (isResponse(who)) return who;

  let body: { name?: unknown; size?: unknown; replaces?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request.", 400);
  }
  const name = cleanName(body.name);
  if (!name.ok) return fail(name.error, 400);
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) return fail("Choose the route PDF to upload.", 400);
  if (size > MAX_ROUTE_BYTES) return fail(`That PDF is too large (${Math.round(MAX_ROUTE_BYTES / 1048576)} MB max). Export it at a lower image quality and try again.`, 400);

  const db = getSupabaseAdmin();
  const setup = await ensureSnowBucket(db);
  if (setup) return fail(setup, 500);

  const routes = await loadRoutes(db);
  const replaces = typeof body.replaces === "string" && ROUTE_ID_RE.test(body.replaces) ? body.replaces : null;
  if (replaces && !routes.some((r) => r.id === replaces)) return fail("That route no longer exists. Reload the page.", 404);
  if (!replaces && routes.length >= MAX_ROUTES) return fail(`There are already ${MAX_ROUTES} routes. Delete an old one first.`, 400);

  const id = randomBytes(12).toString("hex");
  const { data, error } = await db.storage.from(SNOW_BUCKET).createSignedUploadUrl(routePath(id));
  if (error || !data) return fail(`Could not start the upload: ${error?.message ?? "no link"}`, 500);
  return NextResponse.json({ id, uploadUrl: data.signedUrl }, { headers: noStore });
}
