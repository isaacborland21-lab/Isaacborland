"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import styles from "./invoice.module.css";
import {
  BillingSettings,
  CITIES,
  CITY_NAMES,
  City,
  InvoiceBuild,
  InvoiceSnapshot,
  MonthRow,
  ROUND_OPTIONS,
  TYPE_NAMES,
  typeName,
  ALL_TYPES,
  billingFor,
  billToFor,
  poFor,
  defaultInvoiceNo,
  isCity,
  summarize,
  fmtClock,
  fmtLongDate,
  fmtPlainDate,
  fmtShortDate,
  hours,
  isMonth,
  money,
  monthLabel,
  shiftMonth,
} from "@/lib/graffiti";
import { apiJson, photoUrl } from "../clientUtil";

type SentInvoice = { snapshot: InvoiceSnapshot; build: InvoiceBuild; dropped: number[]; changed: boolean };

type InvoiceData = {
  month: string;
  city: City;
  currentMonth: string;
  settings: BillingSettings;
  /** tags finished this month in this city that are on no sent invoice yet */
  build: InvoiceBuild;
  sent: SentInvoice[];
  months: MonthRow[];
  unbilled: string[];
  counts: Record<City, number>;
  invoiceNo: string;
  viewer?: { owner: boolean };
  today: string;
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const jobList = (ids: number[]) => "#" + ids.join(", #");
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export default function InvoicePage() {
  const [month, setMonth] = useState<string | null>(null); // null until the address bar has been read
  const [city, setCity] = useState<City | "">(""); // "" = let the server pick the city with the most tags to invoice
  const [unticked, setUnticked] = useState<Set<number>>(new Set()); // tags left off this invoice (everything else is ticked)
  const [viewId, setViewId] = useState<number | null>(null); // a sent invoice being looked at; null = the one being prepared
  const [data, setData] = useState<InvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // editable header fields for the invoice being viewed
  const [invNo, setInvNo] = useState("");
  const [invDate, setInvDate] = useState("");
  const [showPhotos, setShowPhotos] = useState(true);
  const [draft, setDraft] = useState<BillingSettings | null>(null);
  // the owner's invoice spreadsheet template (kept in private storage, uploaded once)
  const [tpl, setTpl] = useState<{ exists: boolean; updated_at: string | null } | null>(null);
  const loadTpl = useCallback(async () => {
    try {
      setTpl(await apiJson<{ exists: boolean; updated_at: string | null }>("/api/graffiti/invoice/template"));
    } catch {
      setTpl(null);
    }
  }, []);
  useEffect(() => {
    void loadTpl();
  }, [loadTpl]);

  async function uploadTemplate(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      await apiJson("/api/graffiti/invoice/template", { method: "POST", body: fd });
      setFlash({ kind: "ok", text: "Invoice template saved." });
      await loadTpl();
    } catch (e) {
      setFlash({ kind: "bad", text: errMsg(e) });
    }
    setBusy(false);
  }

  useEffect(() => {
    document.title = "Invoice · Isaac Borland";
    const q = new URLSearchParams(window.location.search);
    const m = q.get("month");
    const c = q.get("city");
    setCity(isCity(c) ? c : "");
    setMonth(isMonth(m) ? m : "");
  }, []);

  const load = useCallback(async (m: string, c: City | "", keepFlash = false) => {
    setLoading(true);
    if (!keepFlash) setFlash(null);
    try {
      const qs = [m ? `month=${m}` : "", c ? `city=${c}` : ""].filter(Boolean).join("&");
      const d = await apiJson<InvoiceData>(`/api/graffiti/invoice${qs ? `?${qs}` : ""}`);
      setData(d);
      setError(null);
      setInvNo(d.invoiceNo);
      setInvDate((cur) => cur || d.today);
      setDraft((cur) => cur ?? d.settings);
    } catch (e) {
      setError(errMsg(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (month !== null) void load(month, city);
  }, [month, city, load]);

  function go(m: string, c: City | "" = city) {
    window.history.replaceState(null, "", `/graffiti/invoice?month=${m}${c ? `&city=${c}` : ""}`);
    setUnticked(new Set());
    setViewId(null);
    setMonth(m);
    setCity(c);
  }

  async function post(payload: Record<string, unknown>, okText: string) {
    setBusy(true);
    try {
      await apiJson("/api/graffiti/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setFlash({ kind: "ok", text: okText });
      if (data) await load(data.month, data.city, true);
    } catch (e) {
      setFlash({ kind: "bad", text: errMsg(e) });
    }
    setBusy(false);
  }

  async function mark(ids: number[], cents: number) {
    if (!data) return;
    const { month: m, city: c, currentMonth } = data;
    const msg =
      `Mark ${plural(ids.length, "tag")} as invoiced as ${invNo} (${CITY_NAMES[c]}, ${monthLabel(m)}) for ${money(cents)}?` +
      (m >= currentMonth ? "\n\nThis month is not over yet. Tags finished later will not be on this invoice." : "");
    if (!window.confirm(msg)) return;
    await post({ action: "mark", month: m, city: c, ids, invoice_no: invNo, invoice_date: invDate }, "Marked as invoiced.");
    setUnticked(new Set());
  }

  async function unmark(inv: InvoiceSnapshot) {
    if (!window.confirm(`Remove invoice ${inv.invoice_no}? Its ${plural(inv.jobs, "tag")} go back to "not invoiced". Use this only to fix and re-issue it.`)) return;
    if (viewId === inv.id) setViewId(null);
    await post({ action: "unmark", id: inv.id }, `Invoice ${inv.invoice_no} removed.`);
  }

  async function moveTag(id: number, to: City | "") {
    await post({ action: "set_city", id, city: to }, "Moved.");
  }

  async function saveSettings(ev: React.FormEvent) {
    ev.preventDefault();
    if (!draft || !data) return;
    setBusy(true);
    try {
      const { settings } = await apiJson<{ settings: BillingSettings }>("/api/graffiti/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      setDraft(settings);
      const tzNote = settings.tz !== draft.tz.trim() ? ` The time zone "${draft.tz}" was not recognised, so ${settings.tz} is still in use.` : "";
      setFlash({ kind: tzNote ? "bad" : "ok", text: "Billing settings saved." + tzNote });
      await load(data.month, data.city, true);
    } catch (e) {
      setFlash({ kind: "bad", text: errMsg(e) });
    }
    setBusy(false);
  }

  if (error && !data) {
    return (
      <div className={styles.page}>
        <div className={styles.bar}>
          <div className={`${styles.panel} ${styles.bad}`}>
            <b>{error}</b>
            <div style={{ marginTop: 8 }}>
              <a className={`${styles.btn} ${styles.sec}`} href="/?tab=graffiti">
                ← Back to tracker
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className={styles.page}>
        <div className={styles.bar}>
          <div className={styles.panel}>Loading…</div>
        </div>
      </div>
    );
  }

  const { settings: S, month: m, currentMonth, city: c, sent } = data;
  // crew accounts with the invoice switch can view, download and mark; rates, the template and "undo" stay with the owner
  const isOwner = data.viewer?.owner !== false;
  const tz = S.tz;
  const viewing = sent.find((x) => x.snapshot.id === viewId) ?? null; // a sent invoice, read-only
  const inv = viewing?.snapshot ?? null;
  const build = viewing ? viewing.build : data.build;
  const bill = billingFor(S, inv);
  const { rateCents, minMin, roundTo } = bill;
  // the tags on the sheet: everything on a sent invoice, or the ticked ones of those still to invoice
  const shownLines = viewing ? build.lines : build.lines.filter((l) => !unticked.has(l.id));
  const sum = summarize(shownLines);
  const { byType, tot } = sum;
  const warn = {
    notime: shownLines.filter((l) => l.actual === null).map((l) => l.id),
    noaddr: shownLines.filter((l) => !l.address || l.address.trim() === "").map((l) => l.id),
    noafter: shownLines.filter((l) => !l.after_photo).map((l) => l.id),
  };
  const label = monthLabel(m);
  const cityName = CITY_NAMES[c];
  const noteNo = inv ? inv.invoice_no : invNo.trim() || defaultInvoiceNo(m, c);
  const sheetDate = inv ? inv.invoice_date : invDate;
  const tickedIds = shownLines.map((l) => l.id);
  const dl = viewing ? `invoice=${viewing.snapshot.id}` : `ids=${tickedIds.join(",")}&inv=${encodeURIComponent(noteNo)}${invDate ? `&date=${invDate}` : ""}`;
  const csvHref = `/api/graffiti/invoice?month=${m}&city=${c}&format=csv&${dl}`;
  const xlsxHref = `/api/graffiti/invoice?month=${m}&city=${c}&format=xlsx&${dl}`;
  const toggle = (id: number) =>
    setUnticked((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className={styles.page} aria-busy={loading}>
      <div className={`${styles.bar} ${styles.noprint}`}>
        <div className={styles.panel}>
          <div className={styles.ctl} role="group" aria-label="City" style={{ marginBottom: 10 }}>
            {CITIES.map((k) => (
              <button
                key={k}
                type="button"
                className={`${styles.btn} ${c === k ? "" : styles.sec}`}
                aria-pressed={c === k}
                data-testid={`city-${k}`}
                onClick={() => go(m, k)}
              >
                {CITY_NAMES[k]}
                {data.counts[k] > 0 && <span style={{ opacity: 0.85 }}> ({data.counts[k]} to invoice)</span>}
              </button>
            ))}
          </div>
          <div className={styles.ctl}>
            <div>
              <label>&nbsp;</label>
              <button type="button" className={`${styles.btn} ${styles.sec}`} aria-label="Previous month" onClick={() => go(shiftMonth(m, -1))}>
                ←
              </button>
            </div>
            <div>
              <label htmlFor="inv-month">Month</label>
              <input
                id="inv-month"
                type="month"
                value={m}
                onChange={(e) => isMonth(e.target.value) && go(e.target.value)}
              />
            </div>
            <div>
              <label>&nbsp;</label>
              <button type="button" className={`${styles.btn} ${styles.sec}`} aria-label="Next month" onClick={() => go(shiftMonth(m, 1))}>
                →
              </button>
            </div>
            <div style={{ width: 150 }}>
              <label htmlFor="inv-no">Invoice #</label>
              <input id="inv-no" type="text" maxLength={40} value={inv ? inv.invoice_no : invNo} disabled={!!inv} onChange={(e) => setInvNo(e.target.value)} />
            </div>
            <div>
              <label htmlFor="inv-date">Invoice date</label>
              <input id="inv-date" type="date" value={inv ? inv.invoice_date : invDate} disabled={!!inv} onChange={(e) => setInvDate(e.target.value)} />
            </div>
            <div>
              <label>&nbsp;</label>
              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14, color: "var(--ink)" }}>
                <input type="checkbox" checked={showPhotos} onChange={(e) => setShowPhotos(e.target.checked)} /> Photos
              </label>
            </div>
          </div>
          <div className={styles.ctl} style={{ marginTop: 10 }}>
            <button type="button" className={styles.btn} onClick={() => window.print()}>
              Print / Save as PDF
            </button>
            {tpl?.exists && tot.jobs > 0 && (
              <a className={`${styles.btn} ${styles.green}`} href={xlsxHref} data-testid="xlsx-link">
                Download for Google Sheets (.xlsx)
              </a>
            )}
            <a className={`${styles.btn} ${styles.sec}`} href={csvHref}>
              Download CSV (with actual times)
            </a>
            <a className={`${styles.btn} ${styles.sec}`} href="/?tab=graffiti">
              ← Back to tracker
            </a>
          </div>
        </div>

        {flash && <div className={`${styles.panel} ${flash.kind === "ok" ? styles.ok : styles.bad}`} role="status">{flash.text}</div>}

        {/* invoices already sent for this city and month */}
        {sent.map((x) => {
          const sn = x.snapshot;
          return (
            <div key={sn.id} className={`${styles.panel} ${styles.ok}`} data-testid="invoiced-panel">
              <span className={`${styles.pill} ${styles.pg}`}>Invoiced</span> <b>{sn.invoice_no}</b> · {cityName}, {label} · marked invoiced {fmtLongDate(sn.invoiced_at, tz)}:{" "}
              <b>{money(sn.total_cents)}</b> for {plural(sn.jobs, "tag")} ({money(sn.rate_cents)}/hr, {sn.min_minutes}-min minimum).
              {!x.dropped.length && !x.changed && (
                <span className={styles.sub} style={{ color: "#1e6b34" }}>
                  Matches what was invoiced: nothing removed or changed since.
                </span>
              )}
              {x.dropped.length > 0 && (
                <span className={styles.sub} style={{ color: "#8a5a00" }}>
                  <b>No longer qualify:</b> job {jobList(x.dropped)} was on this invoice but is not a completed {cityName} job in {label} now (status, date or city changed).
                </span>
              )}
              {x.changed && (
                <span className={styles.sub} style={{ color: "#8a5a00" }}>
                  <b>Times changed since it was sent:</b> it was {money(sn.total_cents)} for {sn.billed_min} billed minutes; with today&apos;s records it is {money(x.build.tot.cents)} for{" "}
                  {x.build.tot.billed} billed minutes.
                </span>
              )}
              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {viewId === sn.id ? (
                  <button type="button" className={`${styles.btn} ${styles.sec}`} onClick={() => setViewId(null)}>
                    ← Back to the tags still to invoice
                  </button>
                ) : (
                  <button type="button" className={`${styles.btn} ${styles.sec}`} data-testid="view-sent" onClick={() => setViewId(sn.id)}>
                    View this invoice
                  </button>
                )}
                {isOwner && (
                  <button type="button" className={`${styles.btn} ${styles.red}`} disabled={busy} onClick={() => unmark(sn)}>
                    Undo &quot;invoiced&quot;
                  </button>
                )}
              </div>
              {!isOwner && <span className={styles.sub}>Only the owner can undo this.</span>}
            </div>
          );
        })}

        {/* the tags still to invoice: tick the ones that go on this invoice */}
        {!viewing &&
          (data.build.lines.length > 0 ? (
            <div className={`${styles.panel} ${styles.warn}`} data-testid="not-invoiced-panel">
              <span className={`${styles.pill} ${styles.pa}`}>Not invoiced</span> <b>{cityName}, {label}</b> has {plural(data.build.lines.length, "completed tag")} still to invoice. Tick the ones
              for this invoice: <b data-testid="ticked-count">{shownLines.length}</b> ticked, <b>{money(tot.cents)}</b>.
              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" className={`${styles.btn} ${styles.sec}`} data-testid="tick-all" onClick={() => setUnticked(new Set())}>
                  Tick all
                </button>
                <button type="button" className={`${styles.btn} ${styles.sec}`} data-testid="tick-none" onClick={() => setUnticked(new Set(data.build.ids))}>
                  Untick all
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.green}`}
                  data-testid="mark-btn"
                  disabled={busy || rateCents === 0 || shownLines.length === 0}
                  onClick={() => mark(tickedIds, tot.cents)}
                >
                  Mark {plural(shownLines.length, "ticked tag")} as invoiced
                </button>
              </div>
              <span className={styles.sub}>
                Do this after you send it. It saves the total, rate and those tags. Tags you leave unticked stay here for your next {cityName} invoice.
              </span>
            </div>
          ) : (
            sent.length > 0 && (
              <div className={`${styles.panel} ${styles.ok}`} data-testid="all-invoiced-panel">
                Every finished {cityName} tag in {label} is on an invoice.
              </div>
            )
          ))}

        {data.unbilled.length > 0 && (
          <div className={`${styles.panel} ${styles.warn}`} data-testid="unbilled-panel">
            <span className={`${styles.pill} ${styles.pa}`}>Check</span> Earlier months with {cityName} tags still to invoice:{" "}
            {data.unbilled.map((k, i) => (
              <span key={k}>
                <button type="button" className={styles.linkish} onClick={() => go(k)}>
                  {monthLabel(k, false)}
                </button>
                {i < data.unbilled.length - 1 ? ", " : ""}
              </span>
            ))}
            .
          </div>
        )}

        {rateCents === 0 && (
          <div className={`${styles.panel} ${styles.warn}`}>
            <b>Hourly rate is not set</b>, so amounts show as $0.00. {isOwner ? <>Open <i>Billing settings</i> below and enter your rate.</> : "Ask the owner to set it."}
          </div>
        )}
        {billToFor(S, c).trim() === "" && (
          <div className={`${styles.panel} ${styles.warn}`} data-testid="no-billto">
            <b>No &quot;Bill to&quot; address for {cityName} yet</b>, so the invoice has none. {isOwner ? <>Add it under <i>Billing settings</i> below.</> : "Ask the owner to add it."}
          </div>
        )}
        {(warn.notime.length > 0 || warn.noaddr.length > 0 || warn.noafter.length > 0) && (
          <div className={`${styles.panel} ${styles.warn}`}>
            <b>Check before you send:</b>
            <ul>
              {warn.notime.length > 0 && (
                <li>
                  No time recorded on job {jobList(warn.notime)}. Billed at the {minMin}-minute minimum. Add the real minutes in the tracker.
                </li>
              )}
              {warn.noaddr.length > 0 && <li>No location on job {jobList(warn.noaddr)}.</li>}
              {warn.noafter.length > 0 && <li>No after photo on job {jobList(warn.noafter)}.</li>}
            </ul>
          </div>
        )}

        <details className={styles.panel} open={tpl !== null && !tpl.exists} data-testid="template-panel">
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            Google Sheets invoice {tpl?.exists ? "(template saved)" : tpl ? "(upload your template first)" : ""}
          </summary>
          <p className={styles.sub} style={{ marginTop: 8 }}>
            The download builds your own invoice layout (letterhead, logo, Bill To, columns) with one section per crew member and a subtotal for each, and an
            Instance Reporting tab listing every job. It always bills in half-hour steps with a half-hour minimum, like your sheet does. Open the file in Google
            Sheets (Drive → New → File upload → open with Google Sheets).
          </p>
          <p className={styles.sub}>
            {tpl?.exists
              ? isOwner
                ? "Your template is saved. Upload a new .xlsx only if you change the layout."
                : "The invoice layout is saved. Use the download button above."
              : isOwner
                ? "Download your invoice sheet from Google Sheets (File → Download → Microsoft Excel .xlsx) and upload it here once."
                : "The owner has not uploaded the invoice layout yet."}
          </p>
          {isOwner && <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={busy}
            data-testid="template-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void uploadTemplate(f);
            }}
          />}
        </details>

        <details className={styles.panel} open={data.unbilled.length > 0}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Invoice status by month ({cityName})</summary>
          {data.months.length === 0 ? (
            <p className={styles.sub}>No completed {cityName} jobs yet.</p>
          ) : (
            <div className={styles.tw}>
              <table className={styles.stat} style={{ marginTop: 8, width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">Month</th>
                    <th align="right">Tags</th>
                    <th align="left">Status</th>
                    <th align="left">Invoices</th>
                    <th align="right">Invoiced total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((r) => (
                    <tr key={r.month} className={r.month === m ? styles.cur : undefined}>
                      <td>
                        <button type="button" className={styles.linkish} onClick={() => go(r.month)}>
                          {monthLabel(r.month, false)}
                        </button>
                      </td>
                      <td align="right">{r.count}</td>
                      <td>
                        {r.invoices.length > 0 && r.unbilled === 0 ? (
                          <>
                            <span className={`${styles.pill} ${styles.pg}`}>Invoiced</span>{" "}
                            <span className={styles.sub} style={{ display: "inline" }}>
                              {fmtShortDate(r.invoices[r.invoices.length - 1].invoiced_at, tz)}
                            </span>
                          </>
                        ) : r.invoices.length > 0 ? (
                          <span className={`${styles.pill} ${styles.pa}`}>{r.unbilled} left to invoice</span>
                        ) : r.count === 0 ? (
                          <span className={`${styles.pill} ${styles.pn}`}>No work</span>
                        ) : r.month >= currentMonth ? (
                          <span className={`${styles.pill} ${styles.pn}`}>In progress</span>
                        ) : (
                          <span className={`${styles.pill} ${styles.pa}`}>Not invoiced</span>
                        )}
                      </td>
                      <td>{r.invoices.map((i) => i.invoice_no).join(", ")}</td>
                      <td align="right">{r.invoices.length > 0 ? money(r.invoices.reduce((a, i) => a + i.total_cents, 0)) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>

        {isOwner && <details className={styles.panel}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Billing settings (saved for every new invoice)</summary>
          {draft && (
            <form onSubmit={saveSettings} style={{ marginTop: 12 }}>
              <div className={styles.grid2}>
                <div>
                  <label className={styles.fl} htmlFor="s-biz">Your business name</label>
                  <input id="s-biz" type="text" value={draft.biz_name} onChange={(e) => setDraft({ ...draft, biz_name: e.target.value })} />
                </div>
                <div>
                  <label className={styles.fl} htmlFor="s-contact">Phone / email on invoice</label>
                  <input id="s-contact" type="text" value={draft.biz_contact} onChange={(e) => setDraft({ ...draft, biz_contact: e.target.value })} />
                </div>
                <div>
                  <label className={styles.fl} htmlFor="s-addr">Your address</label>
                  <textarea id="s-addr" value={draft.biz_address} onChange={(e) => setDraft({ ...draft, biz_address: e.target.value })} />
                </div>
                <div>
                  <label className={styles.fl} htmlFor="s-bill">Bill to: Bozeman (department, address)</label>
                  <textarea id="s-bill" value={draft.bill_to} onChange={(e) => setDraft({ ...draft, bill_to: e.target.value })} />
                </div>
                <div>
                  <label className={styles.fl} htmlFor="s-bill-helena">Bill to: Helena (department, address)</label>
                  <textarea id="s-bill-helena" value={draft.bill_to_helena} onChange={(e) => setDraft({ ...draft, bill_to_helena: e.target.value })} />
                </div>
              </div>
              <div className={styles.grid3} style={{ marginTop: 10 }}>
                <div>
                  <label className={styles.fl} htmlFor="s-rate">Hourly rate ($)</label>
                  <input id="s-rate" type="number" step="0.01" min="0" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />
                </div>
                <div>
                  <label className={styles.fl} htmlFor="s-min">Minimum billed per tag (minutes)</label>
                  <input id="s-min" type="number" min="0" max="1440" value={draft.min_minutes} onChange={(e) => setDraft({ ...draft, min_minutes: e.target.value })} />
                </div>
                <div>
                  <label className={styles.fl} htmlFor="s-round">Round time up to nearest</label>
                  <select id="s-round" value={draft.round_to} onChange={(e) => setDraft({ ...draft, round_to: e.target.value })}>
                    {ROUND_OPTIONS.map((v) => (
                      <option key={v} value={String(v)}>
                        {v === 1 ? "1 min (no rounding)" : v === 60 ? "1 hour" : `${v} min`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={styles.fl} htmlFor="s-po">Contract / PO #: Bozeman</label>
                  <input id="s-po" type="text" value={draft.po_number} onChange={(e) => setDraft({ ...draft, po_number: e.target.value })} />
                </div>
                <div>
                  <label className={styles.fl} htmlFor="s-po-helena">Contract / PO #: Helena</label>
                  <input id="s-po-helena" type="text" value={draft.po_number_helena} onChange={(e) => setDraft({ ...draft, po_number_helena: e.target.value })} />
                </div>
                <div>
                  <label className={styles.fl} htmlFor="s-terms">Payment terms / note</label>
                  <input id="s-terms" type="text" value={draft.terms} onChange={(e) => setDraft({ ...draft, terms: e.target.value })} />
                </div>
                <div>
                  <label className={styles.fl} htmlFor="s-tz">Time zone (decides which month a job falls in)</label>
                  <input id="s-tz" type="text" value={draft.tz} onChange={(e) => setDraft({ ...draft, tz: e.target.value })} />
                </div>
              </div>
              <p style={{ margin: "12px 0 0" }}>
                <button type="submit" className={styles.btn} disabled={busy}>
                  Save settings
                </button>
              </p>
              <p className={styles.sub} style={{ marginTop: 8 }}>
                Changing these does not alter months already marked invoiced. They keep the rate and minimum they were sent with.
              </p>
            </form>
          )}
        </details>}
      </div>

      {/* ------------------------------ the invoice ------------------------------ */}
      <div className={styles.sheet} data-testid="invoice-sheet">
        <div className={styles.head}>
          <div className={styles.biz}>
            <b>{S.biz_name || "Your business name"}</b>
            <div>{S.biz_address}</div>
            <div>{S.biz_contact}</div>
          </div>
          <div className={styles.meta}>
            <h1>INVOICE</h1>
            <div>
              <span>Invoice #</span> <b>{noteNo}</b>
            </div>
            <div>
              <span>Date</span> {sheetDate ? fmtPlainDate(sheetDate) : ""}
            </div>
            <div>
              <span>City</span> {cityName}
            </div>
            <div>
              <span>Service period</span> {label}
            </div>
            {poFor(S, c).trim() !== "" && (
              <div>
                <span>Contract / PO #</span> {poFor(S, c)}
              </div>
            )}
          </div>
        </div>

        <div className={styles.billto}>
          <small>Bill to</small>
          {billToFor(S, c)}
        </div>
        <div className={styles.terms}>
          Graffiti removal in {cityName}, {label}. Rate {money(rateCents)} per hour, minimum {minMin} minutes billed per tag
          {roundTo > 1 ? `, time rounded up to the next ${roundTo} minutes` : ""}.
        </div>

        {build.lines.length === 0 ? (
          <div className={styles.empty}>No tags still to invoice for {cityName} in {label}.</div>
        ) : (
          <>
            <div className={styles.tw}>
              <table>
                <thead>
                  <tr>
                    {!viewing && <th className={styles.noprint}>Use</th>}
                    <th>#</th>
                    <th>Date</th>
                    <th>Location</th>
                    <th>Tag</th>
                    <th className={styles.n}>Time on site</th>
                    <th className={styles.n}>Billed</th>
                    <th className={styles.n}>Amount</th>
                    {!viewing && <th className={styles.noprint}>City</th>}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let k = 0;
                    const extra = viewing ? 0 : 1; // the tick column is on screen only
                    return build.people.map((p) => {
                      const on = p.lines.filter((l) => viewing || !unticked.has(l.id));
                      const pt = summarize(on).tot;
                      return (
                        <Fragment key={p.name}>
                          <tr className={`${styles.person} ${on.length === 0 ? styles.noprint : ""}`} data-testid="person-row">
                            <td colSpan={7 + extra * 2}>
                              <b>{p.name}</b> <span className={styles.sub} style={{ display: "inline" }}>{plural(pt.jobs, "tag")}</span>
                            </td>
                          </tr>
                          {p.lines.map((r) => {
                            const ticked = viewing !== null || !unticked.has(r.id);
                            if (ticked) k += 1;
                            const fin = r.finished_at ?? r.removed_at;
                            const detail = r.surface ? `on ${r.surface}` : "";
                            return (
                              <tr key={r.id} className={ticked ? undefined : `${styles.off} ${styles.noprint}`} data-testid="tag-row" data-ticked={ticked}>
                                {!viewing && (
                                  <td className={styles.noprint}>
                                    <input type="checkbox" checked={ticked} aria-label={`Put job ${r.id} on this invoice`} onChange={() => toggle(r.id)} />
                                  </td>
                                )}
                                <td>{ticked ? k : "–"}</td>
                                <td>{fmtShortDate(r.removed_at, tz)}</td>
                                <td>
                                  {r.address || `${r.lat}, ${r.lng}`}
                                  {detail && <span className={styles.sub}>{detail}</span>}
                                  {r.notes && r.notes.trim() !== "" && <span className={styles.sub}>{r.notes}</span>}
                                </td>
                                <td>{typeName(r.type, r.gtype_other)}</td>
                                <td className={styles.n}>
                                  {r.actual === null ? <span className={styles.min}>not recorded</span> : `${r.actual} min`}
                                  {r.started_at && fin && (
                                    <span className={styles.sub}>
                                      {fmtClock(r.started_at, tz)} - {fmtClock(fin, tz)}
                                    </span>
                                  )}
                                </td>
                                <td className={styles.n}>
                                  {r.billed} min
                                  {r.minApplied && <span className={`${styles.sub} ${styles.min}`}>minimum</span>}
                                </td>
                                <td className={styles.n}>{money(r.cents)}</td>
                                {!viewing && (
                                  <td className={styles.noprint}>
                                    <select
                                      aria-label={`City for job ${r.id}`}
                                      value={r.cityName}
                                      disabled={busy}
                                      onChange={(e) => void moveTag(r.id, e.target.value === r.cityAuto ? "" : (e.target.value as City))}
                                    >
                                      {CITIES.map((k2) => (
                                        <option key={k2} value={k2}>
                                          {CITY_NAMES[k2]}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                          <tr className={`${styles.subtotal} ${on.length === 0 ? styles.noprint : ""}`} data-testid="person-subtotal">
                            <td colSpan={5 + extra} className={styles.n}>
                              Subtotal: {p.name}
                            </td>
                            <td className={styles.n}>{hours(pt.billed)}</td>
                            <td className={styles.n}>{money(pt.cents)}</td>
                            {!viewing && <td className={styles.noprint} />}
                          </tr>
                        </Fragment>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>

            <div className={styles.sum}>
              <table>
                <thead>
                  <tr>
                    <th>Summary by tag</th>
                    <th className={styles.n}>Jobs</th>
                    <th className={styles.n}>Actual</th>
                    <th className={styles.n}>Billed</th>
                    <th className={styles.n}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {ALL_TYPES.map((t) => {
                    const b = byType[t];
                    return b ? (
                      <tr key={t}>
                        <td>{TYPE_NAMES[t]}</td>
                        <td className={styles.n}>{b.jobs}</td>
                        <td className={styles.n}>{hours(b.actual)}</td>
                        <td className={styles.n}>{hours(b.billed)}</td>
                        <td className={styles.n}>{money(b.cents)}</td>
                      </tr>
                    ) : null;
                  })}
                </tbody>
              </table>
              <div className={styles.total}>
                <div>
                  <span>Tags removed</span>
                  <b>{tot.jobs}</b>
                </div>
                <div>
                  <span>Time on site</span>
                  <span>{hours(tot.actual)}</span>
                </div>
                <div>
                  <span>Billed time</span>
                  <span>{hours(tot.billed)}</span>
                </div>
                <div className={styles.big}>
                  <span>Total due</span>
                  <span data-testid="total-due">{money(tot.cents)}</span>
                </div>
              </div>
            </div>
          </>
        )}

        {S.terms.trim() !== "" && <div className={styles.foot}>{S.terms}</div>}

        {showPhotos && shownLines.length > 0 && (
          <div className={styles.photosPage}>
            <h2>Photo documentation: {cityName}, {label}</h2>
            <div className={styles.sub}>Before and after photo for each tag. Invoice {noteNo}.</div>
            {shownLines.map((r, k) => (
              <div key={r.id} className={styles.job}>
                <div className={styles.cap}>
                  <b>#{k + 1}</b> · {r.address || `${r.lat}, ${r.lng}`} · {typeName(r.type, r.gtype_other)} · {fmtLongDate(r.removed_at, tz)}
                </div>
                <div className={styles.pair}>
                  {(
                    [
                      ["Before", r.before_photo],
                      ["After", r.after_photo],
                    ] as const
                  ).map(([cap, name]) => {
                    const u = photoUrl(name);
                    return (
                      <figure key={cap}>
                        <figcaption>{cap}</figcaption>
                        {u ? (
                          // eager on purpose: lazy images can be missing from a printout
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={u} alt={cap} />
                        ) : (
                          <div className={styles.ph}>No photo</div>
                        )}
                      </figure>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
