import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { Db, fail, isResponse } from "@/lib/graffitiServer";
import {
  MAX_ROUTE_BYTES,
  ROUTE_ID_RE,
  SNOW_BUCKET,
  SnowRoute,
  cleanName,
  cleanNotes,
  cleanPin,
  cleanStops,
  looksLikePdf,
  routePath,
  sortRoutes,
} from "@/lib/snow";
import { loadRoutes, noStore, requireSnow, saveRoutes } from "@/lib/snowServer";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** Size of an uploaded route PDF and whether it really is a PDF (null = not there). */
async function checkUpload(db: Db, id: string): Promise<{ size: number; pdf: boolean } | null> {
  const { data: files, error } = await db.storage.from(SNOW_BUCKET).list("routes", { search: `${id}.pdf`, limit: 5 });
  if (error) return null;
  const file = (files ?? []).find((f) => f.name === `${id}.pdf`);
  if (!file) return null;
  const size = Number((file.metadata as { size?: number } | null)?.size ?? 0);

  // read only the first KB to check the file type (route PDFs can be tens of MB)
  const { data: link } = await db.storage.from(SNOW_BUCKET).createSignedUrl(routePath(id), 60);
  if (!link?.signedUrl) return { size, pdf: false };
  try {
    const res = await fetch(link.signedUrl, { headers: { Range: "bytes=0-1023" }, cache: "no-store" });
    const head = new Uint8Array(await res.arrayBuffer());
    return { size, pdf: res.ok && looksLikePdf(head) };
  } catch {
    return { size, pdf: false };
  }
}

/**
 * Owner: confirm a new upload (step 2 after POST /api/snow/routes), or change a route's name, notes or pin.
 * With `replaces`, the new PDF takes the old route's place in the list and the old file is deleted.
 * `stops` (one per page, read from the PDF in the browser) replaces the route's stops; leave it out to keep them.
 */
export async function PUT(request: Request, { params }: Ctx) {
  const who = await requireSnow(true);
  if (isResponse(who)) return who;
  if (!ROUTE_ID_RE.test(params.id)) return fail("Route not found.", 404);

  let body: { name?: unknown; notes?: unknown; lat?: unknown; lng?: unknown; replaces?: unknown; stops?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request.", 400);
  }
  if (!body || typeof body !== "object") return fail("Invalid request.", 400);
  const name = cleanName(body.name);
  if (!name.ok) return fail(name.error, 400);
  const pin = cleanPin(body.lat, body.lng);
  if (!pin.ok) return fail(pin.error, 400);
  const notes = cleanNotes(body.notes);
  const stops = "stops" in body ? cleanStops(body.stops) : null;
  if (stops && !stops.ok) return fail(stops.error, 400);

  const db = getSupabaseAdmin();
  const routes = await loadRoutes(db);
  const existing = routes.find((r) => r.id === params.id);

  if (existing) {
    const next = routes.map((r) => (r.id === existing.id ? { ...r, name: name.name, notes, lat: pin.lat, lng: pin.lng, stops: stops ? stops.stops : r.stops } : r));
    const err = await saveRoutes(db, next);
    if (err) return fail(err, 500);
    return NextResponse.json({ routes: sortRoutes(next) }, { headers: noStore });
  }

  // a brand-new upload: make sure the file is there and is a real PDF before anyone sees it
  const upload = await checkUpload(db, params.id);
  if (!upload) return fail("The upload didn't finish. Try again.", 400);
  if (!upload.pdf || upload.size > MAX_ROUTE_BYTES) {
    await db.storage.from(SNOW_BUCKET).remove([routePath(params.id)]);
    return fail(upload.pdf ? "That PDF is too large." : "That file isn't a PDF. Save the route as a PDF and upload it again.", 400);
  }

  const route: SnowRoute = {
    id: params.id,
    name: name.name,
    notes,
    size: upload.size,
    uploaded_at: new Date().toISOString(),
    uploaded_by_name: who.name,
    lat: pin.lat,
    lng: pin.lng,
    stops: stops ? stops.stops : [],
  };
  const replaces = typeof body.replaces === "string" && ROUTE_ID_RE.test(body.replaces) ? body.replaces : null;
  const old = replaces ? routes.find((r) => r.id === replaces) : undefined;
  const next = old ? routes.map((r) => (r.id === old.id ? route : r)) : [...routes, route];
  const err = await saveRoutes(db, next);
  if (err) {
    await db.storage.from(SNOW_BUCKET).remove([routePath(params.id)]);
    return fail(err, 500);
  }
  if (old) await db.storage.from(SNOW_BUCKET).remove([routePath(old.id)]);
  return NextResponse.json({ route, routes: sortRoutes(next) }, { headers: noStore });
}

/** Owner: remove a route and its PDF. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const who = await requireSnow(true);
  if (isResponse(who)) return who;
  if (!ROUTE_ID_RE.test(params.id)) return fail("Route not found.", 404);

  const db = getSupabaseAdmin();
  const routes = await loadRoutes(db);
  if (!routes.some((r) => r.id === params.id)) return fail("Route not found.", 404);
  const next = routes.filter((r) => r.id !== params.id);
  const err = await saveRoutes(db, next);
  if (err) return fail(err, 500);
  await db.storage.from(SNOW_BUCKET).remove([routePath(params.id)]);
  return NextResponse.json({ routes: sortRoutes(next) }, { headers: noStore });
}
