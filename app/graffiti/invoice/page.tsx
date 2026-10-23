"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import styles from "./invoice.module.css";
import {
  BillingSettings,
  InvoiceBuild,
  InvoiceSnapshot,
  MonthRow,
  ROUND_OPTIONS,
  TYPE_NAMES,
  ALL_TYPES,
  billingFor,
  defaultInvoiceNo,
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

type InvoiceData = {
  month: string;
  currentMonth: string;
  settings: BillingSettings;
  snapshot: InvoiceSnapshot | null;
  build: InvoiceBuild;
  diff: { added: number[]; dropped: number[] };
  changed: boolean;
  months: MonthRow[];
  unbilled: string[];
  invoiceNo: string;
  viewer?: { owner: boolean };
  today: string;
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const jobList = (ids: number[]) => "#" + ids.join(", #");
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export default function InvoicePage() {
  const [month, setMonth] = useState<string | null>(null); // null until the address bar has been read
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
    const m = new URLSearchParams(window.location.search).get("month");
    setMonth(isMonth(m) ? m : "");
  }, []);

  const load = useCallback(async (m: string, keepFlash = false) => {
    setLoading(true);
    if (!keepFlash) setFlash(null);
    try {
      const d = await apiJson<InvoiceData>(`/api/graffiti/invoice${m ? `?month=${m}` : ""}`);
      setData(d);
      setError(null);
      setInvNo(d.invoiceNo);
      setInvDate(d.snapshot?.invoice_date ?? d.today);
      setDraft((cur) => cur ?? d.settings);
    } catch (e) {
      setError(errMsg(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (month !== null) void load(month);
  }, [month, load]);

  function go(m: string) {
    window.history.replaceState(null, "", `/graffiti/invoice?month=${m}`);
    setMonth(m);
  }

  async function mark() {
    if (!data) return;
    const { build, month: m, currentMonth } = data;
    const msg =
      `Mark ${monthLabel(m)} as invoiced as ${invNo} for ${money(build.tot.cents)}?` +
      (m >= currentMonth ? "\n\nThis month is not over yet. Tags finished later will not be on this invoice." : "");
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await apiJson("/api/graffiti/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark", month: m, invoice_no: invNo, invoice_date: invDate }),
      });
      setFlash({ kind: "ok", text: "Marked as invoiced." });
      await load(m, true);
    } catch (e) {
      setFlash({ kind: "bad", text: errMsg(e) });
    }
    setBusy(false);
  }

  async function unmark() {
    if (!data) return;
    if (!window.confirm(`Remove the invoiced mark for ${monthLabel(data.month)}? Use this only to fix and re-issue the invoice.`)) return;
    setBusy(true);
    try {
      await apiJson("/api/graffiti/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unmark", month: data.month }),
      });
      setFlash({ kind: "ok", text: "Invoiced mark removed." });
      await load(data.month, true);
    } catch (e) {
      setFlash({ kind: "bad", text: errMsg(e) });
    }
    setBusy(false);
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
      await load(data.month, true);
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

  const { build, snapshot: inv, settings: S, month: m, currentMonth } = data;
  // crew accounts with the invoice switch can view, download and mark; rates, the template and "undo" stay with the owner
  const isOwner = data.viewer?.owner !== false;
  const tz = S.tz;
  const bill = billingFor(S, inv);
  const { rateCents, minMin, roundTo } = bill;
  const { lines, byType, tot, warn } = build;
  const label = monthLabel(m);
  const addedLines = lines.filter((l) => data.diff.added.includes(l.id));
  const addedCents = addedLines.reduce((a, l) => a + l.cents, 0);
  const noteNo = invNo.trim() || defaultInvoiceNo(m);
  const csvHref = `/api/graffiti/invoice?month=${m}&format=csv&inv=${encodeURIComponent(noteNo)}`;
  const xlsxHref = `/api/graffiti/invoice?month=${m}&format=xlsx&inv=${encodeURIComponent(noteNo)}${invDate ? `&date=${invDate}` : ""}`;

  return (
    <div className={styles.page} aria-busy={loading}>
      <div className={`${styles.bar} ${styles.noprint}`}>
        <div className={styles.panel}>
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
              <input id="inv-no" type="text" maxLength={40} value={invNo} disabled={!!inv} onChange={(e) => setInvNo(e.target.value)} />
            </div>
            <div>
              <label htmlFor="inv-date">Invoice date</label>
              <input id="inv-date" type="date" value={invDate} disabled={!!inv} onChange={(e) => setInvDate(e.target.value)} />
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

        {/* invoiced status for this month */}
        {inv ? (
          <>
            <div className={`${styles.panel} ${styles.ok}`} data-testid="invoiced-panel">
              <span className={`${styles.pill} ${styles.pg}`}>Invoiced</span> <b>{label}</b> was marked invoiced as <b>{inv.invoice_no}</b> on{" "}
              {fmtLongDate(inv.invoiced_at, tz)}: <b>{money(inv.total_cents)}</b> for {plural(inv.jobs, "tag")} ({money(inv.rate_cents)}/hr,{" "}
              {inv.min_minutes}-min minimum). This page shows it with those same terms.
              {!data.diff.added.length && !data.diff.dropped.length && !data.changed && (
                <span className={styles.sub} style={{ color: "#1e6b34" }}>
                  Matches what was invoiced: no tags added, removed or changed since.
                </span>
              )}
              {isOwner ? (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className={`${styles.btn} ${styles.red}`} disabled={busy} onClick={unmark}>
                    Undo &quot;invoiced&quot;
                  </button>
                </div>
              ) : (
                <span className={styles.sub}>Only the owner can undo this.</span>
              )}
            </div>
            {data.diff.added.length > 0 && (
              <div className={`${styles.panel} ${styles.warn}`}>
                <b>Not on the invoice you sent:</b> {plural(data.diff.added.length, "tag")} {data.diff.added.length === 1 ? "was" : "were"} finished in {label} after it was
                marked invoiced (job {jobList(data.diff.added)}, {money(addedCents)}). They have not been billed. Undo &quot;invoiced&quot; and re-issue, or bill them separately.
              </div>
            )}
            {data.diff.dropped.length > 0 && (
              <div className={`${styles.panel} ${styles.warn}`}>
                <b>No longer qualify:</b> job {jobList(data.diff.dropped)} was on the invoice you sent but is not a completed job in {label} now (status or date changed).
              </div>
            )}
            {data.changed && (
              <div className={`${styles.panel} ${styles.warn}`}>
                <b>Times changed since it was sent:</b> the invoice you sent was {money(inv.total_cents)} for {inv.billed_min} billed minutes; with today&apos;s records it is{" "}
                {money(tot.cents)} for {tot.billed} billed minutes. A tag&apos;s time was edited after invoicing.
              </div>
            )}
          </>
        ) : (
          tot.jobs > 0 && (
            <div className={`${styles.panel} ${styles.warn}`} data-testid="not-invoiced-panel">
              <span className={`${styles.pill} ${styles.pa}`}>Not invoiced</span> <b>{label}</b> has {plural(tot.jobs, "completed tag")} ({money(tot.cents)}) and has not been
              marked as invoiced.
              <div style={{ marginTop: 8 }}>
                <button type="button" className={`${styles.btn} ${styles.green}`} disabled={busy || rateCents === 0} onClick={mark}>
                  Mark {label} as invoiced
                </button>{" "}
                <span className={styles.sub} style={{ display: "inline" }}>
                  Do this after you send it. It saves the total, rate and tags so you can tell later if anything changed.
                </span>
              </div>
            </div>
          )
        )}

        {data.unbilled.length > 0 && (
          <div className={`${styles.panel} ${styles.warn}`} data-testid="unbilled-panel">
            <span className={`${styles.pill} ${styles.pa}`}>Check</span> Earlier months with finished work that were never marked invoiced:{" "}
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
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Invoice status by month</summary>
          {data.months.length === 0 ? (
            <p className={styles.sub}>No completed jobs yet.</p>
          ) : (
            <div className={styles.tw}>
              <table className={styles.stat} style={{ marginTop: 8, width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">Month</th>
                    <th align="right">Tags</th>
                    <th align="left">Status</th>
                    <th align="left">Invoice</th>
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
                      <td align="right">
                        {r.count}
                        {r.invoice && r.count !== r.invoice.jobs && <span className={styles.min}> (was {r.invoice.jobs})</span>}
                      </td>
                      <td>
                        {r.invoice ? (
                          <>
                            <span className={`${styles.pill} ${styles.pg}`}>Invoiced</span>{" "}
                            <span className={styles.sub} style={{ display: "inline" }}>
                              {fmtShortDate(r.invoice.invoiced_at, tz)}
                            </span>
                          </>
                        ) : r.count === 0 ? (
                          <span className={`${styles.pill} ${styles.pn}`}>No work</span>
                        ) : r.month >= currentMonth ? (
                          <span className={`${styles.pill} ${styles.pn}`}>In progress</span>
                        ) : (
                          <span className={`${styles.pill} ${styles.pa}`}>Not invoiced</span>
                        )}
                      </td>
                      <td>{r.invoice ? r.invoice.invoice_no : ""}</td>
                      <td align="right">{r.invoice ? money(r.invoice.total_cents) : ""}</td>
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
                  <label className={styles.fl} htmlFor="s-bill">Bill to (city department, address)</label>
                  <textarea id="s-bill" value={draft.bill_to} onChange={(e) => setDraft({ ...draft, bill_to: e.target.value })} />
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
                  <label className={styles.fl} htmlFor="s-po">Contract / PO #</label>
                  <input id="s-po" type="text" value={draft.po_number} onChange={(e) => setDraft({ ...draft, po_number: e.target.value })} />
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
              <span>Date</span> {invDate ? fmtPlainDate(invDate) : ""}
            </div>
            <div>
              <span>Service period</span> {label}
            </div>
            {S.po_number.trim() !== "" && (
              <div>
                <span>Contract / PO #</span> {S.po_number}
              </div>
            )}
          </div>
        </div>

        <div className={styles.billto}>
          <small>Bill to</small>
          {S.bill_to}
        </div>
        <div className={styles.terms}>
          Graffiti removal, {label}. Rate {money(rateCents)} per hour, minimum {minMin} minutes billed per tag
          {roundTo > 1 ? `, time rounded up to the next ${roundTo} minutes` : ""}.
        </div>

        {lines.length === 0 ? (
          <div className={styles.empty}>No completed jobs in {label}.</div>
        ) : (
          <>
            <div className={styles.tw}>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Date</th>
                    <th>Location</th>
                    <th>Tag</th>
                    <th className={styles.n}>Time on site</th>
                    <th className={styles.n}>Billed</th>
                    <th className={styles.n}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let k = 0;
                    return build.people.map((p) => (
                      <Fragment key={p.name}>
                        <tr className={styles.person} data-testid="person-row">
                          <td colSpan={7}>
                            <b>{p.name}</b> <span className={styles.sub} style={{ display: "inline" }}>{plural(p.tot.jobs, "tag")}</span>
                          </td>
                        </tr>
                        {p.lines.map((r) => {
                          k += 1;
                          const fin = r.finished_at ?? r.removed_at;
                          const detail = r.surface ? `on ${r.surface}` : "";
                          return (
                            <tr key={r.id}>
                              <td>{k}</td>
                              <td>{fmtShortDate(r.removed_at, tz)}</td>
                              <td>
                                {r.address || `${r.lat}, ${r.lng}`}
                                {detail && <span className={styles.sub}>{detail}</span>}
                                {r.notes && r.notes.trim() !== "" && <span className={styles.sub}>{r.notes}</span>}
                              </td>
                              <td>{TYPE_NAMES[r.type]}</td>
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
                            </tr>
                          );
                        })}
                        <tr className={styles.subtotal} data-testid="person-subtotal">
                          <td colSpan={5} className={styles.n}>
                            Subtotal: {p.name}
                          </td>
                          <td className={styles.n}>{hours(p.tot.billed)}</td>
                          <td className={styles.n}>{money(p.tot.cents)}</td>
                        </tr>
                      </Fragment>
                    ));
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

        {showPhotos && lines.length > 0 && (
          <div className={styles.photosPage}>
            <h2>Photo documentation: {label}</h2>
            <div className={styles.sub}>Before and after photo for each tag. Invoice {noteNo}.</div>
            {lines.map((r, k) => (
              <div key={r.id} className={styles.job}>
                <div className={styles.cap}>
                  <b>#{k + 1}</b> · {r.address || `${r.lat}, ${r.lng}`} · {TYPE_NAMES[r.type]} · {fmtLongDate(r.removed_at, tz)}
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
