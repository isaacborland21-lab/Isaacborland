import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { PHOTO_NAME_RE } from "@/lib/graffiti";
import { BUCKET, fail, isResponse } from "@/lib/graffitiServer";
import { requireAnyJobTab } from "@/lib/jobsServer";

export const dynamic = "force-dynamic";

// Job photos live in the same private bucket as the graffiti ones; this is the only way to see one, and it needs a
// signed-in user who is allowed on at least one job tab. Names are random and never change content, so they cache for good.
export async function GET(_request: Request, { params }: { params: { name: string } }) {
  const who = await requireAnyJobTab();
  if (isResponse(who)) return who;
  if (!PHOTO_NAME_RE.test(params.name)) return fail("Not found.", 404);

  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).download(params.name);
  if (error || !data) return fail("Not found.", 404);

  return new Response(await data.arrayBuffer(), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
