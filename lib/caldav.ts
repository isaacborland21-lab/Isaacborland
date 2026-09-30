// Minimal, dependency-free CalDAV client for Apple Reminders (VTODO).
//
// Apple doesn't offer a "public link" for Reminders the way it does for
// Calendar, so reading someone's reminders needs their own Apple ID and an
// app-specific password (created at appleid.apple.com -> Sign-In and
// Security -> App-Specific Passwords — never their real Apple ID password).
// This talks directly to Apple's CalDAV server with HTTP Basic Auth over
// HTTPS — the same protocol Apple's own Calendar/Reminders apps use — and
// reads back VTODO (to-do / reminder) items. It never writes anything back.
//
// Flow, per RFC 4791 / RFC 6638:
//   1. PROPFIND / for current-user-principal
//   2. PROPFIND {principal} for calendar-home-set
//   3. PROPFIND {home-set}, depth 1, for every collection; keep the ones
//      whose supported-calendar-component-set includes VTODO — those are
//      reminders lists (a plain calendar's component set is VEVENT).
//   4. REPORT each reminders list (calendar-query filtered to VTODO) for
//      its items, and parse each one's iCalendar data.
//
// No XML library — just enough regex-based tag extraction to pull the
// handful of WebDAV/CalDAV properties this needs, in the same spirit as
// lib/ical.ts's dependency-free .ics parser.

import { parseLine, unescapeText, parseDateValue, unfold, zonedToMs, type Prop } from "./ical";

export type ReminderItem = {
  id: string;
  title: string;
  due: string | null; // ISO instant, or null if the reminder has no due date
  completed: boolean;
  priority: number | null; // 1 (high) .. 9 (low); null/0 = none
  list: string;
};

export type ReminderList = { name: string; items: ReminderItem[] };

export class CalDavError extends Error {}

const NS = 'xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"';
const XML_HEADER = '<?xml version="1.0" encoding="utf-8" ?>';

function authHeader(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

// A handful of iCloud's CalDAV entry points 301/302 to a per-account
// partition server (e.g. p01-caldav.icloud.com). fetch() doesn't reliably
// forward the Authorization header across a cross-host redirect, so this
// follows redirects itself and resends auth explicitly every time.
async function dav(url: string, method: string, auth: string, body: string, depth: string): Promise<{ status: number; text: string; url: string }> {
  let target = url;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(target, {
      method,
      redirect: "manual",
      cache: "no-store",
      headers: {
        Authorization: auth,
        Depth: depth,
        "Content-Type": "application/xml; charset=utf-8",
      },
      body,
    });
    if ([301, 302, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) return { status: res.status, text: await res.text().catch(() => ""), url: target };
      target = new URL(loc, target).toString();
      continue;
    }
    return { status: res.status, text: await res.text(), url: target };
  }
  throw new CalDavError("Too many redirects talking to iCloud.");
}

function tagAll(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function tag(xml: string, name: string): string | null {
  const all = tagAll(xml, name);
  return all.length ? all[0] : null;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function responseBlocks(xml: string): string[] {
  return xml.match(/<(?:[\w-]+:)?response[\s\S]*?<\/(?:[\w-]+:)?response>/gi) ?? [];
}

// ---------- Public: read every reminders list for an Apple ID ----------

export async function fetchReminders(appleId: string, appPassword: string): Promise<ReminderList[]> {
  const auth = authHeader(appleId, appPassword);
  const root = "https://caldav.icloud.com/";

  const principalRes = await dav(
    root,
    "PROPFIND",
    auth,
    `${XML_HEADER}<D:propfind ${NS}><D:prop><D:current-user-principal/></D:prop></D:propfind>`,
    "0"
  );
  if (principalRes.status === 401) throw new CalDavError("Apple ID or app-specific password was rejected.");
  if (principalRes.status >= 400) throw new CalDavError(`iCloud returned ${principalRes.status} looking up the account.`);
  const principalHref = tag(principalRes.text, "href");
  if (!principalHref) throw new CalDavError("Couldn't find the account's CalDAV principal.");
  const principalUrl = new URL(decodeXml(principalHref), principalRes.url).toString();

  const homeRes = await dav(
    principalUrl,
    "PROPFIND",
    auth,
    `${XML_HEADER}<D:propfind ${NS}><D:prop><C:calendar-home-set/></D:prop></D:propfind>`,
    "0"
  );
  if (homeRes.status >= 400) throw new CalDavError(`iCloud returned ${homeRes.status} looking up calendars.`);
  const homeHref = tag(homeRes.text, "href");
  if (!homeHref) throw new CalDavError("Couldn't find the account's calendar home.");
  const homeUrl = new URL(decodeXml(homeHref), homeRes.url).toString();

  const listRes = await dav(
    homeUrl,
    "PROPFIND",
    auth,
    `${XML_HEADER}<D:propfind ${NS}><D:prop><D:resourcetype/><D:displayname/><C:supported-calendar-component-set/></D:prop></D:propfind>`,
    "1"
  );
  if (listRes.status >= 400) throw new CalDavError(`iCloud returned ${listRes.status} listing reminders.`);

  const reminderCollections: { url: string; name: string }[] = [];
  for (const block of responseBlocks(listRes.text)) {
    const compNames = Array.from(block.matchAll(/<(?:[\w-]+:)?comp\s+[^>]*name=["']([^"']+)["'][^>]*\/?>/gi)).map((m) =>
      m[1].toUpperCase()
    );
    if (!compNames.includes("VTODO")) continue;
    const href = tag(block, "href");
    if (!href) continue;
    const displayname = tag(block, "displayname");
    reminderCollections.push({
      url: new URL(decodeXml(href), listRes.url).toString(),
      name: displayname ? decodeXml(unescapeText(displayname)) || "Reminders" : "Reminders",
    });
  }

  const lists: ReminderList[] = [];
  for (const col of reminderCollections) {
    try {
      const itemsRes = await dav(
        col.url,
        "REPORT",
        auth,
        `${XML_HEADER}<C:calendar-query ${NS}><D:prop><D:getetag/><C:calendar-data/></D:prop><C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VTODO"/></C:comp-filter></C:filter></C:calendar-query>`,
        "1"
      );
      if (itemsRes.status >= 400) {
        lists.push({ name: col.name, items: [] });
        continue;
      }
      const items: ReminderItem[] = [];
      for (const raw of tagAll(itemsRes.text, "calendar-data")) {
        const item = parseVTodo(decodeXml(raw), col.name);
        if (item && !item.completed) items.push(item);
      }
      items.sort((a, b) => {
        if (a.due && b.due) return a.due.localeCompare(b.due);
        if (a.due) return -1;
        if (b.due) return 1;
        return a.title.localeCompare(b.title);
      });
      lists.push({ name: col.name, items });
    } catch {
      lists.push({ name: col.name, items: [] });
    }
  }
  return lists;
}

function parseVTodo(ics: string, listName: string): ReminderItem | null {
  const lines = unfold(ics);
  let inTodo = false;
  const props: Prop[] = [];
  for (const line of lines) {
    if (!line) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN" && p.value.toUpperCase() === "VTODO") {
      inTodo = true;
      continue;
    }
    if (p.name === "END" && p.value.toUpperCase() === "VTODO") break;
    if (inTodo) props.push(p);
  }
  if (!props.length) return null;

  const get = (n: string) => props.find((p) => p.name === n);
  const status = get("STATUS")?.value.trim().toUpperCase() ?? "NEEDS-ACTION";
  const due = get("DUE") ?? get("DTSTART");
  const dueVal = due ? parseDateValue(due.value, due.params, "UTC") : null;
  const priorityRaw = get("PRIORITY")?.value.trim();
  const priority = priorityRaw ? parseInt(priorityRaw, 10) : null;

  let dueIso: string | null = null;
  if (dueVal) {
    const ms =
      dueVal.tz === null
        ? Date.UTC(dueVal.wall.y, dueVal.wall.m - 1, dueVal.wall.d, dueVal.wall.h, dueVal.wall.mi, dueVal.wall.s)
        : zonedToMs(dueVal.wall, dueVal.tz);
    dueIso = new Date(ms).toISOString();
  }

  return {
    id: get("UID")?.value.trim() || `${listName}-${get("SUMMARY")?.value ?? Math.random()}`,
    title: unescapeText(get("SUMMARY")?.value ?? "(No title)") || "(No title)",
    due: dueIso,
    completed: status === "COMPLETED" || status === "CANCELLED",
    priority: priority && priority > 0 ? priority : null,
    list: listName,
  };
}
