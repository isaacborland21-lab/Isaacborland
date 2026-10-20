import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { PHOTO_NAME_RE } from "@/lib/graffiti";
import { BUCKET, fail, isResponse, requireGraffiti } from "@/lib/graffitiServer";

export const dynamic = "force-dynamic";

// Photos live in a private bucket; this is the only way to see one, and it needs a signed-in user
// who is allowed on the graffiti tab. Names are random, and a given name never changes its content,
// so the browser may cache each one for good (private cache only).
export async function GET(_request: Request, { params }: { params: { name: string } }) {
  const who = await requireGraffiti();
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
