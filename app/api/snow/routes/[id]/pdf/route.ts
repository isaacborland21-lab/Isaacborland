import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fail, isResponse } from "@/lib/graffitiServer";
import { ROUTE_ID_RE, SNOW_BUCKET, routePath } from "@/lib/snow";
import { loadRoutes, noStore, requireSnow } from "@/lib/snowServer";

export const dynamic = "force-dynamic";

// A short-lived private link to one route PDF. The phone downloads the file straight from storage (route PDFs
// are often bigger than this site's server is allowed to send in one response) and keeps a copy for offline use.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const who = await requireSnow();
  if (isResponse(who)) return who;
  if (!ROUTE_ID_RE.test(params.id)) return fail("Route not found.", 404);

  const db = getSupabaseAdmin();
  const routes = await loadRoutes(db);
  if (!routes.some((r) => r.id === params.id)) return fail("Route not found.", 404);

  const { data, error } = await db.storage.from(SNOW_BUCKET).createSignedUrl(routePath(params.id), 10 * 60);
  if (error || !data?.signedUrl) return fail("Could not open that route right now. Try again.", 500);
  return NextResponse.json({ url: data.signedUrl }, { headers: noStore });
}
