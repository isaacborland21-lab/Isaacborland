"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import styles from "../../../graffiti/invoice/invoice.module.css";
import {
  BillingSettings,
  CITIES,
  CITY_NAMES,
  City,
  InvoiceSnapshot,
  MonthRow,
  ROUND_OPTIONS,
  fmtClock,
  fmtLongDate,
  fmtPlainDate,
  fmtShortDate,
  hours,
  isCity,
  isMonth,
  money,
  monthLabel,
  shiftMonth,
} from "@/lib/graffiti";
import { BILL_MODES, BILL_MODE_LABEL, JOB_TYPE_LABEL, JobType, isJobType } from "@/lib/jobs";
import { JobBuild, JobLine, JobSettings, billDescribe, jobBillTo, jobBilling, jobInvoiceNo, jobPoFor, summarizeJobs } from "@/lib/jobInvoice";
import { apiJson } from "../../../graffiti/clientUtil";

type SentInvoice = { snapshot: InvoiceSnapshot; build: JobBuild; dropped: number[]; changed: boolean };

type InvoiceData = {
  type: JobType;
  month: string;
  city: City;
  currentMonth: string;
  shared: BillingSettings;
  settings: JobSettings;
  /** finished jobs this month in this city that are on no sent invoice yet */
  build: JobBuild;
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
const photoSrc = (name: string | null) => (name ? `/api/jobs/photo/${encodeURIComponent(name)}` : null);

export default function JobInvoicePage() {
  const params = useParams<{ type: string }>();
  const type: JobType | null = isJobType(params?.type) ? params.type : null;
  const label = type ? JOB_TYPE_LABEL[type] : "Jobs";
  const api = `/api/jobs/${type}/invoice`;
  const pageUrl = `/jobs/${type}/invoice`;
  const backHref = `/?tab=${encodeURIComponent(label.toLowerCase())}`;

  const [month, setMonth] = useState<string | null>(null); // null until the address bar has been read
  const [city, setCity] = useState<City | "">(""); // "" = let the server pick the city with the most jobs to invoice
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [viewId, setViewId] = useState<number | null>(null); // a sent invoice being looked at; null = the one being prepared
  const [data, setData] = useState<InvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [invNo, setInvNo] = useState("");
  const [invDate, setInvDate] = useState("");
  const [showPhotos, setShowPhotos] = useState(true);
  const [draft, setDraft] = useState<JobSettings | null>(null);

  useEffect(() => {
    document.title = `${label} invoice · Isaac Borland`;
    const q = new URLSearchParams(window.location.search);
    const m = q.get("month");
    const c = q.get("city");
    setCity(isCity(c) ? c : "");
    setMonth(isMonth(m) ? m : "");
  }, [label]);

  const load = useCallback(
    async (m: string, c: City | "", keepFlash = false) => {
      setLoading(true);
      if (!keepFlash) setFlash(null);
      try {
        const qs = [m ? `month=${m}` : "", c ? `city=${c}` : ""].filter(Boolean).join("&");
        const d = await apiJson<InvoiceData>(`${api}${qs ? `?${qs}` : ""}`);
        setData(d);
        setError(null);
        setInvNo(d.invoiceNo);
        setInvDate((cur) => cur || d.today);
        setDraft((cur) => cur ?? d.settings);
      } catch (e) {
        setError(errMsg(e));
      }
      setLoading(false);
    },
    [api],
  );

  useEffect(() => {
    if (type && month !== null) void load(month, city);
  }, [type, month, city, load]);

  function go(m: string, c: City | "" = city) {
    window.history.replaceState(null, "", `${pageUrl}?month=${m}${c ? `&city=${c}` : ""}`);
    setUnticked(new Set());
    setViewId(null);
    setMonth(m);
    setCity(c);
  }

  async function post(payload: Record<string, unknown>, okText: string) {
    setBusy(true);
    try {
      await apiJson(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
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
      `Mark ${plural(ids.length, "job")} as invoiced as ${invNo} (${CITY_NAMES[c]}, ${monthLabel(m)}) for ${money(cents)}?` +
      (m >= currentMonth ? "\n\nThis month is not over yet. Jobs finished later will not be on this invoice." : "");
    if (!window.confirm(msg)) return;
    await post({ action: "mark", month: m, city: c, ids, invoice_no: invNo, invoice_date: invDate }, "Marked as invoiced.");
    setUnticked(new Set());
  }

  async function unmark(inv: InvoiceSnapshot) {
    if (!window.confirm(`Remove invoice ${inv.invoice_no}? Its ${plural(inv.jobs, "job")} go back to "not invoiced". Use this only to fix and re-issue it.`)) return;
    if (viewId === inv.id) setViewId(null);
    await post({ action: "unmark", id: inv.id }, `Invoice ${inv.invoice_no} removed.`);
  }

  async function saveSettings(ev: React.FormEvent) {
    ev.preventDefault();
    if (!draft || !data) return;
    setBusy(true);
    try {
      const { settings } = await apiJson<{ settings: JobSettings }>(`/api/jobs/${type}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      setDraft(settings);
      setFlash({ kind: "ok", text: `${label} billing settings saved.` });
      await load(data.month, data.city, true);
    } catch (e) {
      setFlash({ kind: "bad", text: errMsg(e) });
    }
    setBusy(false);
  }

  if (!type || (error && !data)) {
    return (
      <div className={styles.page}>
        <div className={styles.bar}>
          <div className={`${styles.panel} ${styles.bad}`}>
            <b>{type ? error : "Unknown job type."}</b>
            <div style={{ marginTop: 8 }}>
              <a className={`${styles.btn} ${styles.sec}`} href={type ? backHref : "/"}>
                ← Back
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

  const { settings: S, shared, month: m, currentMonth, city: c, sent } = data;
  const isOwner = data.viewer?.owner !== false;
  const tz = shared.tz;
  const viewing = sent.find((x) => x.snapshot.id === viewId) ?? null;
  const inv = viewing?.snapshot ?? null;
  const build = viewing ? viewing.build : data.build;
  const { rateCents, minMin, roundTo } = jobBilling(S, inv);
  const shownLines: JobLine[] = viewing ? build.lines : build.lines.filter((l) => !unticked.has(l.id));
  const sum = summarizeJobs(shownLines);
  const { tot, byMode } = sum;
  const warn = {
    notime: shownLines.filter((l) => l.bill_mode !== "flat" && l.actual === null).map((l) => l.id),
    noprice: shownLines.filter((l) => l.bill_mode === "flat" && l.price_cents === null).map((l) => l.id),
    noaddr: shownLines.filter((l) => !l.address || l.address.trim() === "").map((l) => l.id),
    noafter: shownLines.filter((l) => !l.after_photo).map((l) => l.id),
  };
  const needsRate = !viewing && rateCents === 0 && shownLines.some((l) => l.bill_mode !== "flat");
  const monthName = monthLabel(m);
  const cityName = CITY_NAMES[c];
  const noteNo = inv ? inv.invoice_no : invNo.trim() || jobInvoiceNo(type, m, c);
  const sheetDate = inv ? inv.invoice_date : invDate;
  const tickedIds = shownLines.map((l) => l.id);
  const dl = viewing ? `invoice=${viewing.snapshot.id}` : `ids=${tickedIds.join(",")}&inv=${encodeURIComponent(noteNo)}${invDate ? `&date=${invDate}` : ""}`;
  const csvHref = `${api}?month=${m}&city=${c}&format=csv&${dl}`;
  const toggle = (id: number) =>
    setUnticked((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const lower = label.toLowerCase();

  return (
    <div className={styles.page} aria-busy={loading} data-testid={`job-invoice-${type}`}>
      <div className={`${styles.bar} ${styles.noprint}`}>
        <div className={styles.panel}>
          <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>{label} invoice</h2>
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
              <input id="inv-month" type="month" value={m} onChange={(e) => isMonth(e.target.value) && go(e.target.value)} />
            </div>
            <div>
              <label>&nbsp;</label>
              <button type="button" className={`${styles.btn} ${styles.sec}`} aria-label="Next month" onClick={() => go(shiftMonth(m, 1))}>
                →
              </button>
            </div>
            <div style={{ width: 170 }}>
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
            <a className={`${styles.btn} ${styles.sec}`} href={csvHref} data-testid="csv-link">
              Download CSV (with actual times)
            </a>
            <a className={`${styles.btn} ${styles.sec}`} href={backHref}>
              ← Back to {lower}
            </a>
          </div>
        </div>

        {flash && (
          <div className={`${styles.panel} ${flash.kind === "ok" ? styles.ok : styles.bad}`} role="status">
            {flash.text}
          </div>
        )}

        {/* invoices already sent for this city and month */}
        {sent.map((x) => {
          const sn = x.snapshot;
          return (
            <div key={sn.id} className={`${styles.panel} ${styles.ok}`} data-testid="invoiced-panel">
              <span className={`${styles.pill} ${styles.pg}`}>Invoiced</span> <b>{sn.invoice_no}</b> · {cityName}, {monthName} · marked invoiced {fmtLongDate(sn.invoiced_at, tz)}:{" "}
              <b>{money(sn.total_cents)}</b> for {plural(sn.jobs, "job")} ({money(sn.rate_cents)}/hr, {sn.min_minutes}-min minimum).
              {!x.dropped.length && !x.changed && (
                <span className={styles.sub} style={{ color: "#1e6b34" }}>
                  Matches what was invoiced: nothing removed or changed since.
                </span>
              )}
              {x.dropped.length > 0 && (
                <span className={styles.sub} style={{ color: "#8a5a00" }}>
                  <b>No longer qualify:</b> job {jobList(x.dropped)} was on this invoice but is not a finished {cityName} job in {monthName} now (status, date or city changed).
                </span>
              )}
              {x.changed && (
                <span className={styles.sub} style={{ color: "#8a5a00" }}>
                  <b>Changed since it was sent:</b> it was {money(sn.total_cents)} for {sn.billed_min} billed minutes; with today&apos;s records it is {money(x.build.tot.cents)} for {x.build.tot.billed}{" "}
                  billed minutes.
                </span>
              )}
              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {viewId === sn.id ? (
                  <button type="button" className={`${styles.btn} ${styles.sec}`} onClick={() => setViewId(null)}>
                    ← Back to the jobs still to invoice
                  </button>
                ) : (
                  <button type="button" className={`${styles.btn} ${styles.sec}`} data-testid="view-sent" onClick={() => setViewId(sn.id)}>
                    View this invoice
                  </button>
                )}
                {isOwner && (
                  <button type="button" className={`${styles.btn} ${styles.red}`} data-testid="undo-btn" disabled={busy} onClick={() => unmark(sn)}>
                    Undo &quot;invoiced&quot;
                  </button>
                )}
              </div>
              {!isOwner && <span className={styles.sub}>Only the owner can undo this.</span>}
            </div>
          );
        })}

        {/* the jobs still to invoice: tick the ones that go on this invoice */}
        {!viewing &&
          (data.build.lines.length > 0 ? (
            <div className={`${styles.panel} ${styles.warn}`} data-testid="not-invoiced-panel">
              <span className={`${styles.pill} ${styles.pa}`}>Not invoiced</span>{" "}
              <b>
                {cityName}, {monthName}
              </b>{" "}
              has {plural(data.build.lines.length, "finished job")} still to invoice. Tick the ones for this invoice: <b data-testid="ticked-count">{shownLines.length}</b> ticked,{" "}
              <b>{money(tot.cents)}</b>.
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
                  disabled={busy || needsRate || warn.noprice.length > 0 || shownLines.length === 0}
                  onClick={() => mark(tickedIds, tot.cents)}
                >
                  Mark {plural(shownLines.length, "ticked job")} as invoiced
                </button>
              </div>
              <span className={styles.sub}>
                Do this after you send it. It saves the total, rate and those jobs. Jobs you leave unticked stay here for your next {cityName} invoice.
              </span>
            </div>
          ) : (
            sent.length > 0 && (
              <div className={`${styles.panel} ${styles.ok}`} data-testid="all-invoiced-panel">
                Every finished {cityName} job in {monthName} is on an invoice.
              </div>
            )
          ))}

        {data.unbilled.length > 0 && (
          <div className={`${styles.panel} ${styles.warn}`} data-testid="unbilled-panel">
            <span className={`${styles.pill} ${styles.pa}`}>Check</span> Earlier months with {cityName} jobs still to invoice:{" "}
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
          <div className={`${styles.panel} ${styles.warn}`} data-testid="no-rate">
            <b>Hourly rate is not set for {lower}</b>, so hourly jobs show as $0.00 (flat-price jobs are fine).{" "}
            {isOwner ? (
              <>
                Open <i>Billing settings</i> below and enter your rate.
              </>
            ) : (
              "Ask the owner to set it."
            )}
          </div>
        )}
        {jobBillTo(S, c).trim() === "" && (
          <div className={`${styles.panel} ${styles.warn}`} data-testid="no-billto">
            <b>No &quot;Bill to&quot; address for {cityName} yet</b>, so the invoice has none.{" "}
            {isOwner ? (
              <>
                Add it under <i>Billing settings</i> below.
              </>
            ) : (
              "Ask the owner to add it."
            )}
          </div>
        )}
        {(warn.notime.length > 0 || warn.noprice.length > 0 || warn.noaddr.length > 0 || warn.noafter.length > 0) && (
          <div className={`${styles.panel} ${styles.warn}`} data-testid="check-panel">
            <b>Check before you send:</b>
            <ul>
              {warn.noprice.length > 0 && <li>Flat-price job {jobList(warn.noprice)} has no price. Set it on the job before marking it invoiced.</li>}
              {warn.notime.length > 0 && (
                <li>
                  No time recorded on job {jobList(warn.notime)}. Billed at the {minMin}-minute minimum. Add the real minutes on the job.
                </li>
              )}
              {warn.noaddr.length > 0 && <li>No location on job {jobList(warn.noaddr)}.</li>}
              {warn.noafter.length > 0 && <li>No after photo on job {jobList(warn.noafter)}.</li>}
            </ul>
          </div>
        )}

        <details className={styles.panel} open={data.unbilled.length > 0}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Invoice status by month ({cityName})</summary>
          {data.months.length === 0 ? (
            <p className={styles.sub}>No finished {cityName} jobs yet.</p>
          ) : (
            <div className={styles.tw}>
              <table className={styles.stat} style={{ marginTop: 8, width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">Month</th>
                    <th align="right">Jobs</th>
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

        {isOwner && (
          <details className={styles.panel} data-testid="settings-panel">
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Billing settings for {lower} (saved for every new invoice)</summary>
            {draft && (
              <form onSubmit={saveSettings} style={{ marginTop: 12 }}>
                <div className={styles.grid3}>
                  <div>
                    <label className={styles.fl} htmlFor="s-rate">
                      Hourly rate ($)
                    </label>
                    <input id="s-rate" type="number" step="0.01" min="0" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />
                  </div>
                  <div>
                    <label className={styles.fl} htmlFor="s-min">
                      Minimum billed per job (minutes)
                    </label>
                    <input id="s-min" type="number" min="0" max="1440" value={draft.min_minutes} onChange={(e) => setDraft({ ...draft, min_minutes: e.target.value })} />
                  </div>
                  <div>
                    <label className={styles.fl} htmlFor="s-round">
                      Round time up to nearest
                    </label>
                    <select id="s-round" value={draft.round_to} onChange={(e) => setDraft({ ...draft, round_to: e.target.value })}>
                      {ROUND_OPTIONS.map((v) => (
                        <option key={v} value={String(v)}>
                          {v === 1 ? "1 min (no rounding)" : v === 60 ? "1 hour" : `${v} min`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={styles.grid2} style={{ marginTop: 10 }}>
                  <div>
                    <label className={styles.fl} htmlFor="s-bill">
                      Bill to: Bozeman (department, address)
                    </label>
                    <textarea id="s-bill" value={draft.bill_to} onChange={(e) => setDraft({ ...draft, bill_to: e.target.value })} />
                  </div>
                  <div>
                    <label className={styles.fl} htmlFor="s-bill-helena">
                      Bill to: Helena (department, address)
                    </label>
                    <textarea id="s-bill-helena" value={draft.bill_to_helena} onChange={(e) => setDraft({ ...draft, bill_to_helena: e.target.value })} />
                  </div>
                  <div>
                    <label className={styles.fl} htmlFor="s-po">
                      Contract / PO #: Bozeman
                    </label>
                    <input id="s-po" type="text" value={draft.po_number} onChange={(e) => setDraft({ ...draft, po_number: e.target.value })} />
                  </div>
                  <div>
                    <label className={styles.fl} htmlFor="s-po-helena">
                      Contract / PO #: Helena
                    </label>
                    <input id="s-po-helena" type="text" value={draft.po_number_helena} onChange={(e) => setDraft({ ...draft, po_number_helena: e.target.value })} />
                  </div>
                </div>
                <p style={{ margin: "12px 0 0" }}>
                  <button type="submit" className={styles.btn} disabled={busy}>
                    Save settings
                  </button>
                </p>
                <p className={styles.sub} style={{ marginTop: 8 }}>
                  Each job type has its own rate. Your business name, address, phone, payment terms and time zone are shared with the graffiti invoice (change them under Graffiti → Invoice → Billing settings).
                  Changing these does not alter invoices already marked invoiced. Flat-price jobs ignore the rate.
                </p>
              </form>
            )}
          </details>
        )}
      </div>

      {/* ------------------------------ the invoice ------------------------------ */}
      <div className={styles.sheet} data-testid="invoice-sheet">
        <div className={styles.head}>
          <div className={styles.biz}>
            <b>{shared.biz_name || "Your business name"}</b>
            <div>{shared.biz_address}</div>
            <div>{shared.biz_contact}</div>
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
              <span>Service period</span> {monthName}
            </div>
            {jobPoFor(S, c).trim() !== "" && (
              <div>
                <span>Contract / PO #</span> {jobPoFor(S, c)}
              </div>
            )}
          </div>
        </div>

        <div className={styles.billto}>
          <small>Bill to</small>
          {jobBillTo(S, c)}
        </div>
        <div className={styles.terms}>
          {label} in {cityName}, {monthName}. Hourly jobs: {money(rateCents)} per hour, minimum {minMin} minutes billed per job
          {roundTo > 1 ? `, time rounded up to the next ${roundTo} minutes` : ""}. Flat-price jobs are billed at the agreed price.
        </div>

        {build.lines.length === 0 ? (
          <div className={styles.empty}>
            No {lower} jobs still to invoice for {cityName} in {monthName}.
          </div>
        ) : (
          <>
            <div className={styles.tw}>
              <table>
                <thead>
                  <tr>
                    {!viewing && <th className={styles.noprint}>Use</th>}
                    <th>#</th>
                    <th>Date</th>
                    <th>Job</th>
                    <th>Billing</th>
                    <th className={styles.n}>Time on site</th>
                    <th className={styles.n}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let k = 0;
                    const extra = viewing ? 0 : 1; // the tick column is on screen only
                    return build.people.map((p) => {
                      const on = p.lines.filter((l) => viewing || !unticked.has(l.id));
                      const pt = summarizeJobs(on).tot;
                      return (
                        <Fragment key={p.name}>
                          <tr className={`${styles.person} ${on.length === 0 ? styles.noprint : ""}`} data-testid="person-row">
                            <td colSpan={6 + extra}>
                              <b>{p.name}</b>{" "}
                              <span className={styles.sub} style={{ display: "inline" }}>
                                {plural(pt.jobs, "job")}
                              </span>
                            </td>
                          </tr>
                          {p.lines.map((r) => {
                            const ticked = viewing !== null || !unticked.has(r.id);
                            if (ticked) k += 1;
                            const fin = r.finished_at ?? r.done_at;
                            return (
                              <tr key={r.id} className={ticked ? undefined : `${styles.off} ${styles.noprint}`} data-testid="job-row" data-ticked={ticked}>
                                {!viewing && (
                                  <td className={styles.noprint}>
                                    <input type="checkbox" checked={ticked} aria-label={`Put job ${r.id} on this invoice`} onChange={() => toggle(r.id)} />
                                  </td>
                                )}
                                <td>{ticked ? k : "–"}</td>
                                <td>{fmtShortDate(r.done_at, tz)}</td>
                                <td>
                                  {r.wo_number ? `#${r.wo_number} · ` : ""}
                                  {r.title}
                                  {r.address && <span className={styles.sub}>{r.address}</span>}
                                  {r.notes && r.notes.trim() !== "" && <span className={styles.sub}>{r.notes}</span>}
                                  {r.bill_mode === "hourly_materials" &&
                                    r.materials.map((mt, i) => (
                                      <span key={i} className={styles.sub}>
                                        {mt.desc}: {money(mt.cents)}
                                      </span>
                                    ))}
                                </td>
                                <td>
                                  {BILL_MODE_LABEL[r.bill_mode]}
                                  {r.bill_mode !== "flat" && <span className={styles.sub}>{billDescribe(r, money)}</span>}
                                  {r.minApplied && <span className={`${styles.sub} ${styles.min}`}>minimum</span>}
                                </td>
                                <td className={styles.n}>
                                  {r.bill_mode === "flat" ? (
                                    r.actual === null ? (
                                      ""
                                    ) : (
                                      `${r.actual} min`
                                    )
                                  ) : r.actual === null ? (
                                    <span className={styles.min}>not recorded</span>
                                  ) : (
                                    `${r.actual} min`
                                  )}
                                  {r.started_at && fin && (
                                    <span className={styles.sub}>
                                      {fmtClock(r.started_at, tz)} - {fmtClock(fin, tz)}
                                    </span>
                                  )}
                                </td>
                                <td className={styles.n}>
                                  {money(r.cents)}
                                  {!viewing && (
                                    <select
                                      className={styles.noprint}
                                      aria-label={`City for job ${r.id}`}
                                      value={r.city}
                                      disabled={busy}
                                      style={{ display: "block", marginTop: 4 }}
                                      onChange={(e) => void post({ action: "set_city", id: r.id, city: e.target.value }, "Moved.")}
                                    >
                                      {CITIES.map((k2) => (
                                        <option key={k2} value={k2}>
                                          {CITY_NAMES[k2]}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          <tr className={`${styles.subtotal} ${on.length === 0 ? styles.noprint : ""}`} data-testid="person-subtotal">
                            <td colSpan={5 + extra} className={styles.n}>
                              Subtotal: {p.name}
                            </td>
                            <td className={styles.n}>{money(pt.cents)}</td>
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
                    <th>Summary by billing</th>
                    <th className={styles.n}>Jobs</th>
                    <th className={styles.n}>Billed time</th>
                    <th className={styles.n}>Materials</th>
                    <th className={styles.n}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {BILL_MODES.map((bm) => {
                    const b = byMode[bm];
                    return b ? (
                      <tr key={bm}>
                        <td>{BILL_MODE_LABEL[bm]}</td>
                        <td className={styles.n}>{b.jobs}</td>
                        <td className={styles.n}>{bm === "flat" ? "" : hours(b.billed)}</td>
                        <td className={styles.n}>{bm === "hourly_materials" ? money(b.materials) : ""}</td>
                        <td className={styles.n}>{money(b.cents)}</td>
                      </tr>
                    ) : null;
                  })}
                </tbody>
              </table>
              <div className={styles.total}>
                <div>
                  <span>Jobs</span>
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

        {shared.terms.trim() !== "" && <div className={styles.foot}>{shared.terms}</div>}

        {showPhotos && shownLines.length > 0 && (
          <div className={styles.photosPage}>
            <h2>
              Photo documentation: {cityName}, {monthName}
            </h2>
            <div className={styles.sub}>Before and after photo for each job. Invoice {noteNo}.</div>
            {shownLines.map((r, i) => (
              <div key={r.id} className={styles.job}>
                <div className={styles.cap}>
                  <b>#{i + 1}</b> · {r.wo_number ? `#${r.wo_number} · ` : ""}
                  {r.title}
                  {r.address ? ` · ${r.address}` : ""} · {fmtLongDate(r.done_at, tz)}
                </div>
                <div className={styles.pair}>
                  {(
                    [
                      ["Before", r.before_photo],
                      ["After", r.after_photo],
                    ] as const
                  ).map(([cap, name]) => {
                    const u = photoSrc(name);
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
