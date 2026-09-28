import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { canEditTab, PublicMetadata } from "@/lib/supabaseAdmin";

// Imports a recipe from a link. Almost every recipe site embeds a
// schema.org "Recipe" object as JSON-LD for Google's rich results, with
// ingredients (amounts included) and steps already separated. We fetch the
// page server-side, find that object, and return a cleaned-up version.
// Nothing is saved here — the client fills the form and the user reviews it.

export const dynamic = "force-dynamic";

// Basic guard so this can't be pointed at internal/private addresses.
const BLOCKED_HOST =
  /^(localhost|0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|.*\.local$|.*\.internal$)/i;

type Json = unknown;
type Obj = Record<string, Json>;

const NAMED: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  frac13: "⅓",
  frac23: "⅔",
  deg: "°",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

function codePoint(n: number) {
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

function decodeOnce(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => codePoint(Number(d)))
    .replace(/&([a-z0-9]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

// Decode (twice — some sites double-encode), strip any HTML, tidy whitespace.
function clean(s: string) {
  return decodeOnce(decodeOnce(s))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecipeType(t: Json) {
  if (typeof t === "string") return t === "Recipe" || t.endsWith("/Recipe");
  return Array.isArray(t) && t.some((x) => isRecipeType(x));
}

function findRecipe(node: Json, depth = 0): Obj | null {
  if (!node || typeof node !== "object" || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  const obj = node as Obj;
  if (isRecipeType(obj["@type"])) return obj;
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
    if (key in obj) {
      const r = findRecipe(obj[key], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function flattenSteps(node: Json, out: string[], depth = 0) {
  if (node == null || depth > 8) return;
  if (typeof node === "string") {
    // Some sites put every step in one string, separated by <li>/<br>/newlines.
    node
      .split(/<\/li>|<br\s*\/?>|<\/p>|\n+/i)
      .map(clean)
      .filter(Boolean)
      .forEach((s) => out.push(s));
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => flattenSteps(n, out, depth + 1));
    return;
  }
  if (typeof node === "object") {
    const o = node as Obj;
    // HowToSection: a named group of steps.
    if (o.itemListElement) {
      flattenSteps(o.itemListElement, out, depth + 1);
      return;
    }
    const t = typeof o.text === "string" ? o.text : typeof o.name === "string" ? o.name : "";
    if (t) flattenSteps(t, out, depth + 1);
  }
}

function toStrings(v: Json): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap((x) => (typeof x === "string" ? [x] : []));
  return [];
}

function parseRecipe(r: Obj) {
  const name = clean(typeof r.name === "string" ? r.name : "");
  const ingredients = toStrings(r.recipeIngredient ?? r.ingredients)
    .map(clean)
    .filter(Boolean);
  const steps: string[] = [];
  flattenSteps(r.recipeInstructions, steps);
  return { name, ingredients, steps };
}

function extractRecipe(html: string) {
  const re = /<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let data: Json;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const found = findRecipe(data);
    if (!found) continue;
    const parsed = parseRecipe(found);
    if (parsed.ingredients.length || parsed.steps.length) return parsed;
  }
  return null;
}

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const { userId } = auth();
  if (!userId) return fail("Not signed in.", 401);

  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  if (!canEditTab(user.publicMetadata as PublicMetadata, "food")) {
    return fail("Not permitted to add recipes.", 403);
  }

  let url: URL;
  try {
    const body = (await request.json()) as { url?: unknown };
    url = new URL(String(body.url ?? "").trim());
  } catch {
    return fail("That doesn't look like a valid link.", 400);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || BLOCKED_HOST.test(url.hostname)) {
    return fail("That link can't be imported.", 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let html: string;
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      return fail(
        `The site refused the request (${res.status}). Some sites block automated imports — you'll need to add this one by hand.`,
        502
      );
    }
    html = await res.text();
  } catch (e) {
    const aborted = (e as Error).name === "AbortError";
    return fail(aborted ? "The site took too long to respond." : "Couldn't reach that site.", 502);
  } finally {
    clearTimeout(timer);
  }

  const recipe = extractRecipe(html);
  if (!recipe) {
    return fail(
      "Couldn't find a recipe on that page. The site doesn't publish structured recipe data (or it's behind a paywall) — add it by hand.",
      422
    );
  }

  return NextResponse.json({ ...recipe, source: url.toString() });
}
