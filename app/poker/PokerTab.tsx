"use client";

import { useEffect, useMemo, useState } from "react";

// Poker night: a running money leaderboard for the group, a log of every night played,
// and a chip calculator that splits a buy-in across five chip colors.
// Everything lives in tab_content under "poker" and is saved through /api/content/poker.
// All money is stored in whole cents so totals never drift from float rounding.

const mono = "'IBM Plex Mono', monospace";
const sans = "'IBM Plex Sans', sans-serif";

export type PokerPlayer = { id: string; name: string };
export type PokerEntry = { playerId: string; buyIn: number; cashOut: number };
export type PokerSession = { id: string; date: string; note: string; entries: PokerEntry[] };
export type ChipColor = { name: string; color: string; value: number; owned: number };
export type ChipSetup = { buyIn: number; seats: number; colors: ChipColor[] };
export type PokerContent = { players: PokerPlayer[]; sessions: PokerSession[]; chips: ChipSetup };

export const DEFAULT_CHIPS: ChipSetup = {
  buyIn: 2000,
  seats: 6,
  colors: [
    { name: "White", color: "#f2efe6", value: 25, owned: 0 },
    { name: "Red", color: "#c8372d", value: 50, owned: 0 },
    { name: "Green", color: "#2f9a52", value: 100, owned: 0 },
    { name: "Blue", color: "#2f5fc4", value: 200, owned: 0 },
    { name: "Black", color: "#1b1b1b", value: 500, owned: 0 },
  ],
};

export function normalizePoker(raw: unknown): PokerContent {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<PokerContent>;
  const chips =
    r.chips && Array.isArray(r.chips.colors) && r.chips.colors.length === 5 ? (r.chips as ChipSetup) : DEFAULT_CHIPS;
  return {
    players: Array.isArray(r.players) ? r.players : [],
    sessions: Array.isArray(r.sessions) ? r.sessions : [],
    chips,
  };
}

// ---------- money helpers ----------

function fmt(c: number): string {
  const sign = c < 0 ? "-" : "";
  const a = Math.abs(c);
  return `${sign}$${(a / 100).toFixed(a % 100 === 0 ? 0 : 2)}`;
}
function fmtSigned(c: number): string {
  return c > 0 ? `+${fmt(c)}` : fmt(c);
}
/** "$20", "20.5", "" → cents. Returns null when it isn't a money amount. */
function parseMoney(s: string): number | null {
  const t = s.replace(/[$,\s]/g, "");
  if (t === "") return 0;
  if (!/^\d*\.?\d{0,2}$/.test(t) || t === ".") return null;
  return Math.round(parseFloat(t) * 100);
}
function toInput(c: number): string {
  return c === 0 ? "" : (c / 100).toString();
}
function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

// ---------- chip math ----------

// Share of the buy-in's value each chip gets, smallest denomination first.
// Lots of small chips for betting, fewer big ones.
const SHARES = [0.1, 0.2, 0.3, 0.25, 0.15];

/** How many of each chip one player gets for `buyIn` cents. Returns counts by color index plus any cents that couldn't be made. */
export function splitBuyIn(buyIn: number, values: number[]): { counts: number[]; leftover: number } {
  const counts = values.map(() => 0);
  const order = values
    .map((_, i) => i)
    .filter((i) => values[i] > 0)
    .sort((a, b) => values[a] - values[b]);
  if (buyIn <= 0 || order.length === 0) return { counts, leftover: Math.max(buyIn, 0) };

  let remaining = buyIn;
  // Everyone gets at least one of each color when the buy-in covers it.
  for (const i of order) {
    if (values[i] <= remaining) {
      counts[i] = 1;
      remaining -= values[i];
    }
  }
  // Spread the rest by the target shares.
  const raw = SHARES.slice(0, order.length);
  const total = raw.reduce((a, b) => a + b, 0);
  const pool = remaining;
  order.forEach((i, rank) => {
    const c = Math.floor((pool * raw[rank]) / total / values[i]);
    counts[i] += c;
    remaining -= c * values[i];
  });
  // Mop up whatever's left with the biggest chips that fit.
  for (const i of [...order].reverse()) {
    const c = Math.floor(remaining / values[i]);
    counts[i] += c;
    remaining -= c * values[i];
  }
  return { counts, leftover: remaining };
}

// Denomination ladders (cents) that split cleanly. Picked so the smallest chip is roughly 1/80 of the buy-in.
const LADDERS = [
  [5, 10, 25, 50, 100],
  [10, 25, 50, 100, 500],
  [25, 50, 100, 200, 500],
  [50, 100, 200, 500, 1000],
  [100, 200, 500, 1000, 2500],
  [100, 500, 1000, 2500, 5000],
  [500, 1000, 2500, 5000, 10000],
  [1000, 2500, 5000, 10000, 25000],
  [2500, 5000, 10000, 25000, 50000],
];
export function suggestValues(buyIn: number): number[] {
  const target = Math.max(buyIn / 80, 1);
  let best = LADDERS[0];
  let bestDist = Infinity;
  for (const l of LADDERS) {
    const d = Math.abs(Math.log(l[0]) - Math.log(target));
    if (d < bestDist) {
      best = l;
      bestDist = d;
    }
  }
  return best;
}

// ---------- shared styles ----------

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--surface-border)",
  borderRadius: 4,
  color: "var(--text)",
  fontFamily: sans,
  fontSize: 14,
  padding: "7px 9px",
};
const moneyInput: React.CSSProperties = { ...inputStyle, fontFamily: mono, textAlign: "right" };
const btn: React.CSSProperties = {
  fontFamily: sans,
  fontSize: 13,
  padding: "8px 14px",
  borderRadius: 4,
  cursor: "pointer",
};
const primaryBtn: React.CSSProperties = { ...btn, background: "var(--accent)", border: "none", color: "#1a0f08", fontWeight: 600 };
const ghostBtn: React.CSSProperties = { ...btn, background: "none", border: "1px solid var(--surface-border)", color: "var(--text-dim)" };
const linkBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontFamily: mono,
  fontSize: 12,
  color: "var(--accent)",
  padding: 0,
};
const label: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 11,
  color: "var(--text-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  margin: "0 0 6px 0",
};
const th: React.CSSProperties = { ...label, textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--surface-border)", margin: 0 };
const td: React.CSSProperties = { fontFamily: sans, fontSize: 14, padding: "8px 8px", borderBottom: "1px solid var(--surface-border)" };
const errorText: React.CSSProperties = { fontFamily: sans, fontSize: 13, color: "#e88", margin: "8px 0 0 0" };
const dim: React.CSSProperties = { fontFamily: sans, fontSize: 13, color: "var(--text-dim)", margin: 0 };
const netColor = (c: number) => (c > 0 ? "#8fbf7f" : c < 0 ? "#e88" : "var(--text-dim)");

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>;
}

// ---------- main tab ----------

type View = "Leaderboard" | "Nights" | "Chips";

export default function PokerTab({ data, onSave }: { data: PokerContent; onSave: (next: PokerContent) => Promise<void> }) {
  const [view, setView] = useState<View>("Leaderboard");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: PokerContent): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {(["Leaderboard", "Nights", "Chips"] as View[]).map((v) => (
          <button key={v} onClick={() => setView(v)} style={v === view ? primaryBtn : ghostBtn}>
            {v === "Chips" ? "Chip calculator" : v}
          </button>
        ))}
        {saving && <span style={{ ...dim, fontFamily: mono, fontSize: 12 }}>Saving…</span>}
      </div>
      {error && (
        <Card>
          <p style={{ ...errorText, margin: 0 }}>{error}</p>
        </Card>
      )}
      {view === "Leaderboard" && <Leaderboard data={data} save={save} onNewNight={() => setView("Nights")} />}
      {view === "Nights" && <Nights data={data} save={save} />}
      {view === "Chips" && <ChipCalculator data={data} save={save} />}
    </div>
  );
}

// ---------- leaderboard + roster ----------

function Leaderboard({
  data,
  save,
  onNewNight,
}: {
  data: PokerContent;
  save: (next: PokerContent) => Promise<boolean>;
  onNewNight: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const stats = useMemo(() => {
    return data.players
      .map((p) => {
        let net = 0,
          played = 0,
          wins = 0,
          best = 0,
          worst = 0,
          bought = 0;
        for (const s of data.sessions) {
          const e = s.entries.find((x) => x.playerId === p.id);
          if (!e) continue;
          const d = e.cashOut - e.buyIn;
          played++;
          net += d;
          bought += e.buyIn;
          if (d > 0) wins++;
          if (d > best) best = d;
          if (d < worst) worst = d;
        }
        return { ...p, net, played, wins, best, worst, bought };
      })
      .sort((a, b) => b.net - a.net || b.played - a.played);
  }, [data]);

  async function addPlayer() {
    const name = newName.trim();
    if (!name) return;
    if (data.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      setMsg(`${name} is already on the list.`);
      return;
    }
    setMsg(null);
    if (await save({ ...data, players: [...data.players, { id: uid(), name }] })) setNewName("");
  }

  async function rename(id: string) {
    const name = renameText.trim();
    if (!name) return;
    if (await save({ ...data, players: data.players.map((p) => (p.id === id ? { ...p, name } : p)) })) setRenaming(null);
  }

  async function remove(id: string) {
    const used = data.sessions.some((s) => s.entries.some((e) => e.playerId === id));
    if (used) {
      setMsg("That player has nights on record. Delete those nights (or just leave them on the board) first.");
      return;
    }
    setMsg(null);
    await save({ ...data, players: data.players.filter((p) => p.id !== id) });
  }

  const totalPot = data.sessions.reduce((a, s) => a + s.entries.reduce((b, e) => b + e.buyIn, 0), 0);

  return (
    <>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <h2 style={{ fontFamily: mono, fontSize: 22, margin: 0 }}>All-time standings</h2>
          <span style={{ ...dim, fontFamily: mono, fontSize: 12 }}>
            {data.sessions.length} night{data.sessions.length === 1 ? "" : "s"} · {fmt(totalPot)} bought in
          </span>
        </div>
        {stats.length === 0 ? (
          <p style={dim}>No players yet. Add your crew below, then log your first night.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={th}>#</th>
                  <th style={th}>Player</th>
                  <th style={{ ...th, textAlign: "right" }}>Net</th>
                  <th style={{ ...th, textAlign: "right" }}>Nights</th>
                  <th style={{ ...th, textAlign: "right" }}>Won</th>
                  <th style={{ ...th, textAlign: "right" }}>Best</th>
                  <th style={{ ...th, textAlign: "right" }}>Worst</th>
                  <th style={{ ...th, textAlign: "right" }}>Avg / night</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s, i) => (
                  <tr key={s.id}>
                    <td style={{ ...td, fontFamily: mono, color: "var(--text-dim)" }}>{i === 0 && s.net > 0 ? "♠" : i + 1}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{s.name}</td>
                    <td style={{ ...td, fontFamily: mono, textAlign: "right", color: netColor(s.net), fontWeight: 600 }}>{fmtSigned(s.net)}</td>
                    <td style={{ ...td, fontFamily: mono, textAlign: "right" }}>{s.played}</td>
                    <td style={{ ...td, fontFamily: mono, textAlign: "right" }}>
                      {s.wins}
                      {s.played > 0 && <span style={{ color: "var(--text-dim)" }}> ({Math.round((s.wins / s.played) * 100)}%)</span>}
                    </td>
                    <td style={{ ...td, fontFamily: mono, textAlign: "right", color: netColor(s.best) }}>{s.played ? fmtSigned(s.best) : "–"}</td>
                    <td style={{ ...td, fontFamily: mono, textAlign: "right", color: netColor(s.worst) }}>{s.played ? fmtSigned(s.worst) : "–"}</td>
                    <td style={{ ...td, fontFamily: mono, textAlign: "right", color: netColor(s.net) }}>
                      {s.played ? fmtSigned(Math.round(s.net / s.played)) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.players.length > 0 && (
          <button style={{ ...primaryBtn, marginTop: 16 }} onClick={onNewNight}>
            Log a night →
          </button>
        )}
      </Card>

      <Card>
        <p style={label}>Players</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {data.players.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
              {renaming === p.id ? (
                <>
                  <input
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && rename(p.id)}
                    style={{ ...inputStyle, maxWidth: 260 }}
                    autoFocus
                  />
                  <span style={{ display: "flex", gap: 12 }}>
                    <button style={linkBtn} onClick={() => rename(p.id)}>Save</button>
                    <button style={{ ...linkBtn, color: "var(--text-dim)" }} onClick={() => setRenaming(null)}>Cancel</button>
                  </span>
                </>
              ) : (
                <>
                  <span style={{ fontFamily: sans, fontSize: 14 }}>{p.name}</span>
                  <span style={{ display: "flex", gap: 12 }}>
                    <button
                      style={linkBtn}
                      onClick={() => {
                        setRenaming(p.id);
                        setRenameText(p.name);
                      }}
                    >
                      Rename
                    </button>
                    <button style={{ ...linkBtn, color: "#e88" }} onClick={() => remove(p.id)}>Remove</button>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPlayer()}
            placeholder="Add a player"
            style={{ ...inputStyle, maxWidth: 260 }}
          />
          <button style={primaryBtn} onClick={addPlayer}>Add</button>
        </div>
        {msg && <p style={errorText}>{msg}</p>}
      </Card>
    </>
  );
}

// ---------- nights (sessions) ----------

function Nights({ data, save }: { data: PokerContent; save: (next: PokerContent) => Promise<boolean> }) {
  const [editing, setEditing] = useState<PokerSession | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const nameOf = (id: string) => data.players.find((p) => p.id === id)?.name ?? "(removed player)";
  const sorted = [...data.sessions].sort((a, b) => b.date.localeCompare(a.date));

  if (editing) {
    return (
      <NightEditor
        players={data.players}
        initial={editing === "new" ? null : editing}
        defaultBuyIn={data.chips.buyIn}
        onCancel={() => setEditing(null)}
        onSubmit={async (s) => {
          const exists = data.sessions.some((x) => x.id === s.id);
          const sessions = exists ? data.sessions.map((x) => (x.id === s.id ? s : x)) : [...data.sessions, s];
          if (await save({ ...data, sessions })) setEditing(null);
        }}
      />
    );
  }

  return (
    <>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ fontFamily: mono, fontSize: 22, margin: 0 }}>Poker nights</h2>
          <button style={primaryBtn} onClick={() => setEditing("new")} disabled={data.players.length === 0}>
            + Log a night
          </button>
        </div>
        {data.players.length === 0 && <p style={{ ...dim, marginTop: 10 }}>Add players on the Leaderboard first.</p>}
        {data.players.length > 0 && sorted.length === 0 && <p style={{ ...dim, marginTop: 10 }}>No nights logged yet.</p>}
      </Card>
      {sorted.map((s) => {
        const buy = s.entries.reduce((a, e) => a + e.buyIn, 0);
        const out = s.entries.reduce((a, e) => a + e.cashOut, 0);
        const off = out - buy;
        const rows = [...s.entries].sort((a, b) => b.cashOut - b.buyIn - (a.cashOut - a.buyIn));
        return (
          <Card key={s.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <div>
                <p style={{ fontFamily: mono, fontSize: 15, fontWeight: 600, margin: 0 }}>{prettyDate(s.date)}</p>
                {s.note && <p style={{ ...dim, marginTop: 2 }}>{s.note}</p>}
              </div>
              <span style={{ display: "flex", gap: 14 }}>
                <button style={linkBtn} onClick={() => setEditing(s)}>Edit</button>
                {confirmDelete === s.id ? (
                  <>
                    <button
                      style={{ ...linkBtn, color: "#e88" }}
                      onClick={async () => {
                        if (await save({ ...data, sessions: data.sessions.filter((x) => x.id !== s.id) })) setConfirmDelete(null);
                      }}
                    >
                      Yes, delete
                    </button>
                    <button style={{ ...linkBtn, color: "var(--text-dim)" }} onClick={() => setConfirmDelete(null)}>Keep</button>
                  </>
                ) : (
                  <button style={{ ...linkBtn, color: "#e88" }} onClick={() => setConfirmDelete(s.id)}>Delete</button>
                )}
              </span>
            </div>
            {rows.map((e) => {
              const d = e.cashOut - e.buyIn;
              return (
                <div key={e.playerId} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", fontFamily: sans, fontSize: 14 }}>
                  <span>{nameOf(e.playerId)}</span>
                  <span style={{ fontFamily: mono }}>
                    <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
                      in {fmt(e.buyIn)} · out {fmt(e.cashOut)}
                    </span>{" "}
                    <span style={{ color: netColor(d), fontWeight: 600, display: "inline-block", minWidth: 70, textAlign: "right" }}>{fmtSigned(d)}</span>
                  </span>
                </div>
              );
            })}
            <p style={{ ...dim, fontFamily: mono, fontSize: 12, marginTop: 8 }}>
              Pot {fmt(buy)}
              {off !== 0 && (
                <span style={{ color: "#e8b04a" }}> · cash-outs are {off > 0 ? "over" : "short"} by {fmt(Math.abs(off))}</span>
              )}
            </p>
          </Card>
        );
      })}
    </>
  );
}

type Row = { on: boolean; buyIn: string; cashOut: string };

function NightEditor({
  players,
  initial,
  defaultBuyIn,
  onCancel,
  onSubmit,
}: {
  players: PokerPlayer[];
  initial: PokerSession | null;
  defaultBuyIn: number;
  onCancel: () => void;
  onSubmit: (s: PokerSession) => Promise<void>;
}) {
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [note, setNote] = useState(initial?.note ?? "");
  const [rows, setRows] = useState<Record<string, Row>>(() => {
    const r: Record<string, Row> = {};
    for (const p of players) {
      const e = initial?.entries.find((x) => x.playerId === p.id);
      r[p.id] = e
        ? { on: true, buyIn: toInput(e.buyIn), cashOut: toInput(e.cashOut) }
        : { on: !initial, buyIn: toInput(defaultBuyIn), cashOut: "" };
    }
    return r;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Players removed from the roster but present on an old night stay on that night.
  const orphanEntries = initial?.entries.filter((e) => !players.some((p) => p.id === e.playerId)) ?? [];

  const set = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const active = players.filter((p) => rows[p.id]?.on);
  const buyTotal = active.reduce((a, p) => a + (parseMoney(rows[p.id].buyIn) ?? 0), 0) + orphanEntries.reduce((a, e) => a + e.buyIn, 0);
  const outTotal = active.reduce((a, p) => a + (parseMoney(rows[p.id].cashOut) ?? 0), 0) + orphanEntries.reduce((a, e) => a + e.cashOut, 0);
  const off = outTotal - buyTotal;

  async function submit() {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("Pick a date.");
    if (active.length === 0) return setError("Tick at least one player who played.");
    const entries: PokerEntry[] = [];
    for (const p of active) {
      const b = parseMoney(rows[p.id].buyIn);
      const c = parseMoney(rows[p.id].cashOut);
      if (b === null || c === null) return setError(`Check ${p.name}'s amounts. Use plain dollars like 20 or 12.50.`);
      entries.push({ playerId: p.id, buyIn: b, cashOut: c });
    }
    setBusy(true);
    try {
      await onSubmit({ id: initial?.id ?? uid(), date, note: note.trim(), entries: [...entries, ...orphanEntries] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 style={{ fontFamily: mono, fontSize: 22, margin: "0 0 14px 0" }}>{initial ? "Edit night" : "Log a night"}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 180px) 1fr", gap: 10, marginBottom: 16 }}>
        <div>
          <p style={label}>Date</p>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <p style={label}>Note (optional)</p>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="At Jake's, ran till 2am" style={inputStyle} />
        </div>
      </div>

      <p style={{ ...dim, marginBottom: 10 }}>
        Tick who played. Buy-in is everything they put in that night, so hit <strong>+ rebuy</strong> each time someone reloads. Cash-out is what
        their chips were worth at the end.
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
          <thead>
            <tr>
              <th style={th}>Played</th>
              <th style={{ ...th, textAlign: "right" }}>Buy-in $</th>
              <th style={th}></th>
              <th style={{ ...th, textAlign: "right" }}>Cash-out $</th>
              <th style={{ ...th, textAlign: "right" }}>Net</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const r = rows[p.id];
              const b = parseMoney(r.buyIn);
              const c = parseMoney(r.cashOut);
              const net = b !== null && c !== null ? c - b : null;
              return (
                <tr key={p.id} style={{ opacity: r.on ? 1 : 0.45 }}>
                  <td style={td}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input type="checkbox" checked={r.on} onChange={(e) => set(p.id, { on: e.target.checked })} />
                      {p.name}
                    </label>
                  </td>
                  <td style={{ ...td, width: 110 }}>
                    <input
                      value={r.buyIn}
                      disabled={!r.on}
                      inputMode="decimal"
                      onChange={(e) => set(p.id, { buyIn: e.target.value })}
                      style={{ ...moneyInput, borderColor: b === null ? "#e88" : undefined }}
                    />
                  </td>
                  <td style={{ ...td, width: 70 }}>
                    <button
                      style={{ ...linkBtn, fontSize: 11, opacity: r.on ? 1 : 0.4 }}
                      disabled={!r.on}
                      onClick={() => set(p.id, { buyIn: toInput((parseMoney(r.buyIn) ?? 0) + defaultBuyIn) })}
                      title={`Add another ${fmt(defaultBuyIn)}`}
                    >
                      + rebuy
                    </button>
                  </td>
                  <td style={{ ...td, width: 110 }}>
                    <input
                      value={r.cashOut}
                      disabled={!r.on}
                      inputMode="decimal"
                      placeholder="0"
                      onChange={(e) => set(p.id, { cashOut: e.target.value })}
                      style={{ ...moneyInput, borderColor: c === null ? "#e88" : undefined }}
                    />
                  </td>
                  <td style={{ ...td, fontFamily: mono, textAlign: "right", color: r.on && net !== null ? netColor(net) : "var(--text-dim)" }}>
                    {r.on && net !== null ? fmtSigned(net) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12, fontFamily: mono, fontSize: 13 }}>
        <span>Pot in: {fmt(buyTotal)}</span>
        <span>Cashed out: {fmt(outTotal)}</span>
        <span style={{ color: off === 0 ? "#8fbf7f" : "#e8b04a" }}>
          {off === 0 ? "✓ Balanced" : `${off > 0 ? "Over" : "Short"} by ${fmt(Math.abs(off))}`}
        </span>
      </div>
      {off !== 0 && outTotal > 0 && (
        <p style={{ ...dim, marginTop: 6 }}>
          Cash-outs should add up to the pot. If they don&apos;t, a count is off somewhere. You can still save it.
        </p>
      )}
      {error && <p style={errorText}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button style={primaryBtn} onClick={submit} disabled={busy}>
          {busy ? "Saving…" : "Save night"}
        </button>
        <button style={ghostBtn} onClick={onCancel}>Cancel</button>
      </div>
    </Card>
  );
}

// ---------- chip calculator ----------

type ColorDraft = { name: string; color: string; value: string; owned: string };

function draftFrom(chips: ChipSetup) {
  return {
    buyIn: toInput(chips.buyIn),
    seats: String(chips.seats),
    colors: chips.colors.map((c) => ({ name: c.name, color: c.color, value: toInput(c.value), owned: c.owned ? String(c.owned) : "" })),
  };
}

function ChipCalculator({ data, save }: { data: PokerContent; save: (next: PokerContent) => Promise<boolean> }) {
  const [buyInStr, setBuyInStr] = useState(() => draftFrom(data.chips).buyIn);
  const [seatsStr, setSeatsStr] = useState(() => draftFrom(data.chips).seats);
  const [colors, setColors] = useState<ColorDraft[]>(() => draftFrom(data.chips).colors);
  const [savedMsg, setSavedMsg] = useState(false);

  useEffect(() => {
    const d = draftFrom(data.chips);
    setBuyInStr(d.buyIn);
    setSeatsStr(d.seats);
    setColors(d.colors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(data.chips)]);

  const buyIn = parseMoney(buyInStr);
  const seats = Math.max(0, Math.floor(Number(seatsStr) || 0));
  const values = colors.map((c) => parseMoney(c.value) ?? 0);
  const badValue = colors.some((c) => parseMoney(c.value) === null);
  const { counts, leftover } = splitBuyIn(buyIn ?? 0, values);
  const perPlayerValue = counts.reduce((a, n, i) => a + n * values[i], 0);
  const perPlayerChips = counts.reduce((a, n) => a + n, 0);

  const setColor = (i: number, patch: Partial<ColorDraft>) => setColors((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  function suggest() {
    if (!buyIn) return;
    const ladder = suggestValues(buyIn);
    setColors((cs) => cs.map((c, i) => ({ ...c, value: toInput(ladder[i]) })));
  }

  const draftChips: ChipSetup | null =
    buyIn === null || badValue
      ? null
      : {
          buyIn,
          seats: seats || 1,
          colors: colors.map((c, i) => ({ name: c.name.trim() || `Color ${i + 1}`, color: c.color, value: values[i], owned: Math.max(0, Math.floor(Number(c.owned) || 0)) })),
        };
  const dirty = draftChips !== null && JSON.stringify(draftChips) !== JSON.stringify(data.chips);

  // Rows shown smallest value first so it reads like a chip rack.
  const order = colors.map((_, i) => i).sort((a, b) => (values[a] || Infinity) - (values[b] || Infinity));

  return (
    <Card>
      <h2 style={{ fontFamily: mono, fontSize: 22, margin: "0 0 6px 0" }}>Chip calculator</h2>
      <p style={{ ...dim, marginBottom: 16 }}>
        Set the buy-in and how many people are playing. Set the chip values yourself or hit <strong>Suggest values</strong>, and it works out how
        many of each color to hand every player.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 18 }}>
        <div style={{ width: 140 }}>
          <p style={label}>Buy-in per player $</p>
          <input value={buyInStr} inputMode="decimal" onChange={(e) => setBuyInStr(e.target.value)} style={{ ...moneyInput, borderColor: buyIn === null ? "#e88" : undefined }} />
        </div>
        <div style={{ width: 100 }}>
          <p style={label}>Players</p>
          <input value={seatsStr} inputMode="numeric" onChange={(e) => setSeatsStr(e.target.value.replace(/\D/g, ""))} style={moneyInput} />
        </div>
        <button style={ghostBtn} onClick={suggest} disabled={!buyIn}>Suggest values</button>
        {data.players.length > 0 && (
          <button style={ghostBtn} onClick={() => setSeatsStr(String(data.players.length))}>
            Use roster ({data.players.length})
          </button>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
          <thead>
            <tr>
              <th style={th}>Chip</th>
              <th style={{ ...th, textAlign: "right" }}>Value $</th>
              <th style={{ ...th, textAlign: "right" }}>Per player</th>
              <th style={{ ...th, textAlign: "right" }}>Worth</th>
              <th style={{ ...th, textAlign: "right" }}>Need total</th>
              <th style={{ ...th, textAlign: "right" }}>You own</th>
            </tr>
          </thead>
          <tbody>
            {order.map((i) => {
              const c = colors[i];
              const need = counts[i] * seats;
              const owned = Math.floor(Number(c.owned) || 0);
              const short = owned > 0 && need > owned;
              return (
                <tr key={i}>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <label
                        title="Change color"
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          background: c.color,
                          border: "3px dashed rgba(255,255,255,0.55)",
                          boxShadow: "0 0 0 1px var(--surface-border)",
                          flexShrink: 0,
                          cursor: "pointer",
                          position: "relative",
                        }}
                      >
                        <input
                          type="color"
                          value={c.color}
                          onChange={(e) => setColor(i, { color: e.target.value })}
                          style={{ opacity: 0, position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "pointer" }}
                        />
                      </label>
                      <input value={c.name} onChange={(e) => setColor(i, { name: e.target.value })} style={{ ...inputStyle, maxWidth: 110 }} />
                    </div>
                  </td>
                  <td style={{ ...td, width: 100 }}>
                    <input
                      value={c.value}
                      inputMode="decimal"
                      onChange={(e) => setColor(i, { value: e.target.value })}
                      style={{ ...moneyInput, borderColor: parseMoney(c.value) === null ? "#e88" : undefined }}
                    />
                  </td>
                  <td style={{ ...td, fontFamily: mono, textAlign: "right", fontSize: 18, fontWeight: 700 }}>{counts[i]}</td>
                  <td style={{ ...td, fontFamily: mono, textAlign: "right", color: "var(--text-dim)" }}>{fmt(counts[i] * values[i])}</td>
                  <td style={{ ...td, fontFamily: mono, textAlign: "right", color: short ? "#e88" : undefined }}>
                    {need}
                    {short && <span style={{ fontSize: 11 }}> (short {need - owned})</span>}
                  </td>
                  <td style={{ ...td, width: 90 }}>
                    <input
                      value={c.owned}
                      inputMode="numeric"
                      placeholder="?"
                      onChange={(e) => setColor(i, { owned: e.target.value.replace(/\D/g, "") })}
                      style={moneyInput}
                    />
                  </td>
                </tr>
              );
            })}
            <tr>
              <td style={{ ...td, fontFamily: mono, fontWeight: 600 }}>Each player</td>
              <td style={td}></td>
              <td style={{ ...td, fontFamily: mono, textAlign: "right", fontWeight: 600 }}>{perPlayerChips}</td>
              <td style={{ ...td, fontFamily: mono, textAlign: "right", fontWeight: 600 }}>{fmt(perPlayerValue)}</td>
              <td style={{ ...td, fontFamily: mono, textAlign: "right" }}>{perPlayerChips * seats}</td>
              <td style={td}></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={{ ...dim, fontFamily: mono, fontSize: 13 }}>
          Total on the table: {fmt((buyIn ?? 0) * seats)} across {perPlayerChips * seats} chips
        </p>
        {badValue && <p style={{ ...errorText, margin: 0 }}>One of the chip values isn&apos;t a dollar amount.</p>}
        {!badValue && leftover > 0 && (
          <p style={{ fontFamily: sans, fontSize: 13, color: "#e8b04a", margin: 0 }}>
            These values can&apos;t make exactly {fmt(buyIn ?? 0)}. {fmt(leftover)} per player is left over, so lower your smallest chip or
            change the buy-in.
          </p>
        )}
        {colors.some((c, i) => Math.floor(Number(c.owned) || 0) > 0 && counts[i] * seats > Math.floor(Number(c.owned) || 0)) && (
          <p style={{ fontFamily: sans, fontSize: 13, color: "#e88", margin: 0 }}>
            You don&apos;t own enough of some colors for this many players. Raise those chips&apos; values or trim the buy-in.
          </p>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
        <button
          style={primaryBtn}
          disabled={!dirty}
          onClick={async () => {
            if (draftChips && (await save({ ...data, chips: draftChips }))) {
              setSavedMsg(true);
              window.setTimeout(() => setSavedMsg(false), 2000);
            }
          }}
        >
          Save chip setup
        </button>
        <span style={{ ...dim, fontSize: 12 }}>
          {savedMsg ? "Saved." : dirty ? "Unsaved changes. The buy-in here is also the default when logging a night." : "Saved setup loaded."}
        </span>
      </div>
    </Card>
  );
}
