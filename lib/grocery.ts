// Turns a pile of ingredient lines ("1 ½ cups rice", "2 lb chicken thighs")
// into one combined grocery list, grouped by store section.
//
// Lines that start with a quantity (and optional unit) are merged when the
// unit and ingredient name match: "1 cup rice" + "1 cup rice" -> "2 cup rice".
// Anything we can't parse confidently (ranges like "2-3", "salt to taste")
// is kept as written, with exact duplicates collapsed into "(x2)".
// It does NOT convert between units (1 lb + 8 oz stays as two lines).

export type GrocerySection = { section: string; items: string[] };

const FRACTION_CHARS: Record<string, number> = {
  "½": 1 / 2,
  "¼": 1 / 4,
  "¾": 3 / 4,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 1 / 8,
};
const FRAC = "[½¼¾⅓⅔⅛]";

const UNIT_ALIASES: Record<string, string> = {
  cup: "cup", cups: "cup", c: "cup",
  tbsp: "tbsp", tbsps: "tbsp", tbs: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  tsp: "tsp", tsps: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  oz: "oz", ounce: "oz", ounces: "oz",
  g: "g", gram: "g", grams: "g", kg: "kg",
  ml: "ml", l: "l", liter: "l", liters: "l",
  quart: "quart", quarts: "quart", pint: "pint", pints: "pint",
  can: "can", cans: "can", jar: "jar", jars: "jar",
  bag: "bag", bags: "bag", box: "box", boxes: "box",
  package: "package", packages: "package", pkg: "package",
  packet: "packet", packets: "packet", container: "container", containers: "container",
  clove: "clove", cloves: "clove", head: "head", heads: "head",
  bunch: "bunch", bunches: "bunch", stick: "stick", sticks: "stick",
  slice: "slice", slices: "slice",
};

type Parsed = { qty: number; unit: string; name: string };

function parseQuantity(s: string): { qty: number; rest: string } | null {
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)\s*/); // 1 1/2
  if (m) return { qty: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: s.slice(m[0].length) };
  m = s.match(/^(\d+)\/(\d+)\s*/); // 1/2
  if (m) return { qty: Number(m[1]) / Number(m[2]), rest: s.slice(m[0].length) };
  m = s.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(${FRAC})?\\s*`)); // 1.5 | 1½ | 1 ½
  if (m) return { qty: Number(m[1]) + (m[2] ? FRACTION_CHARS[m[2]] : 0), rest: s.slice(m[0].length) };
  m = s.match(new RegExp(`^(${FRAC})\\s*`)); // ½
  if (m) return { qty: FRACTION_CHARS[m[1]], rest: s.slice(m[0].length) };
  return null;
}

export function parseIngredient(line: string): Parsed | null {
  const q = parseQuantity(line.trim());
  if (!q || !Number.isFinite(q.qty) || q.qty <= 0) return null;
  // Ranges ("2-3 cloves", "2 to 3 cups") aren't safe to add up.
  if (/^(-|–|to\s+\d)/i.test(q.rest)) return null;
  // "1 (15 oz) can black beans": set the size aside, keep it on the name.
  let size = "";
  let rest = q.rest;
  const paren = rest.match(/^(\([^)]*\))\s*/);
  if (paren) {
    size = paren[1];
    rest = rest.slice(paren[0].length);
  }
  const words = rest.split(/\s+/);
  const first = (words[0] ?? "").toLowerCase().replace(/\.$/, "");
  let unit = "";
  if (UNIT_ALIASES[first]) {
    unit = UNIT_ALIASES[first];
    words.shift();
  }
  const name = words
    .join(" ")
    .replace(/^of\s+/i, "")
    .trim()
    .toLowerCase();
  if (!name) return null;
  return { qty: q.qty, unit, name: size ? `${name} ${size.toLowerCase()}` : name };
}

const GLYPHS: [number, string][] = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [1 / 2, "½"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
];

export function formatQty(n: number): string {
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.02) return String(whole);
  for (const [v, g] of GLYPHS) {
    if (Math.abs(frac - v) < 0.02) return whole ? `${whole}${g}` : g;
  }
  return String(Math.round(n * 100) / 100);
}

export const SECTION_ORDER = ["Produce", "Meat & Seafood", "Dairy & Eggs", "Bakery", "Frozen", "Pantry", "Other"];

const has = (name: string, words: string[]) => words.some((w) => name.includes(w));

// Checked in order, so specific phrases ("peanut butter", "bell pepper")
// win over the looser keywords that come after them.
export function sectionFor(name: string, unit = ""): string {
  const n = name.toLowerCase();
  if (has(n, ["frozen"])) return "Frozen";
  if (["can", "jar", "packet", "box"].includes(unit)) return "Pantry";
  if (has(n, ["tortilla", "bread", "bun", "roll", "pita", "naan", "bagel"])) return "Bakery";
  if (has(n, ["peanut butter", "broth", "stock", "black pepper", "salt", "powder", "seasoning", "sauce", "marinara", "salsa", "pesto", "oil", "vinegar", "honey", "sugar", "flour", "spice", "cumin", "paprika", "oregano", "cornstarch"])) return "Pantry";
  if (has(n, ["chicken", "beef", "steak", "pork", "turkey", "sausage", "bacon", "ham", "salmon", "shrimp", "fish", "lamb", "chorizo"])) return "Meat & Seafood";
  if (has(n, ["milk", "cheese", "cheddar", "mozzarella", "feta", "ricotta", "parmesan", "butter", "yogurt", "cream", "egg", "tzatziki"])) return "Dairy & Eggs";
  if (has(n, ["pepper", "onion", "garlic", "lime", "lemon", "cilantro", "parsley", "basil", "broccoli", "spinach", "lettuce", "kale", "tomato", "cucumber", "carrot", "cabbage", "potato", "green bean", "avocado", "coleslaw", "ginger", "scallion", "jalape", "mushroom", "zucchini", "corn", "celery", "apple", "banana", "berries", "herb"])) return "Produce";
  if (has(n, ["rice", "pasta", "ziti", "rotini", "penne", "spaghetti", "noodle", "quinoa", "bean", "chiles", "lentil", "oats", "cereal"])) return "Pantry";
  return "Other";
}

export function buildGroceryList(lines: string[]): GrocerySection[] {
  const merged = new Map<string, Parsed>();
  const loose = new Map<string, { text: string; count: number }>();

  for (const raw of lines) {
    const line = raw.trim().replace(/^[-•*]\s*/, "");
    if (!line) continue;
    const p = parseIngredient(line);
    if (p) {
      const key = `${p.unit}|${p.name}`;
      const prev = merged.get(key);
      if (prev) prev.qty += p.qty;
      else merged.set(key, { ...p });
    } else {
      const key = line.toLowerCase();
      const prev = loose.get(key);
      if (prev) prev.count += 1;
      else loose.set(key, { text: line, count: 1 });
    }
  }

  const bySection = new Map<string, { sort: string; text: string }[]>();
  const add = (section: string, sort: string, text: string) => {
    const list = bySection.get(section) ?? [];
    list.push({ sort, text });
    bySection.set(section, list);
  };

  for (const p of Array.from(merged.values())) {
    add(sectionFor(p.name, p.unit), p.name, `${formatQty(p.qty)} ${p.unit ? p.unit + " " : ""}${p.name}`);
  }
  for (const l of Array.from(loose.values())) {
    add(sectionFor(l.text), l.text.toLowerCase(), l.count > 1 ? `${l.text} (x${l.count})` : l.text);
  }

  return SECTION_ORDER.filter((s) => bySection.has(s)).map((section) => ({
    section,
    items: (bySection.get(section) ?? []).sort((a, b) => a.sort.localeCompare(b.sort)).map((i) => i.text),
  }));
}

export function groceryListToText(sections: GrocerySection[], title: string): string {
  const out = [title, ""];
  for (const s of sections) {
    out.push(s.section.toUpperCase());
    for (const item of s.items) out.push(`[ ] ${item}`);
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}
