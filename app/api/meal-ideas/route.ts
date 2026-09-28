import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { canEditTab, PublicMetadata } from "@/lib/supabaseAdmin";
import { randomPrepMeals } from "@/lib/mealdb";

// Returns fresh meal ideas (with ingredients and steps) from TheMealDB for
// the Food tab's "Refresh week" button. Nothing is saved here.

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(request: Request) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  if (!canEditTab(user.publicMetadata as PublicMetadata, "food")) {
    return NextResponse.json({ error: "Not permitted to edit the meal plan." }, { status: 403 });
  }

  let count = 7;
  let exclude: string[] = [];
  try {
    const body = (await request.json()) as { count?: unknown; exclude?: unknown };
    count = Math.min(14, Math.max(1, Math.floor(Number(body.count) || 7)));
    if (Array.isArray(body.exclude)) exclude = body.exclude.filter((x): x is string => typeof x === "string").slice(0, 50);
  } catch {
    // defaults are fine
  }

  try {
    const meals = await randomPrepMeals(count, exclude);
    return NextResponse.json({ meals }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Couldn't fetch meal ideas." }, { status: 502 });
  }
}
