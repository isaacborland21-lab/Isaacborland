"use client";

import { useEffect, useRef, useState } from "react";
import g from "../graffiti/graffiti.module.css";
import s from "./snow.module.css";
import { SnowRoute, fmtSize } from "@/lib/snow";
import { PdfJs, errMsg, getRouteBytes, loadPdfJs } from "./pdf";

// The route PDF on screen, one page (one location) at a time: ‹ Prev / Next › (or swipe) to move through
// the route, the stop's name on top, zoom and full screen for reading the map. Stops and arriving at a
// property jump straight to its page. Only the page on screen is drawn, which also keeps long
// aerial-photo PDFs well inside a phone's memory.

/** Phones refuse canvases above ~16 million pixels (iPhone Safari) and draw them blank, so stay under it. */
const MAX_CANVAS_PX = 16_000_000;

export type Jump = { page: number; n: number }; // n changes on every request, so the same page can be asked for twice

const pageKey = (id: string) => `snow_page_${id}`;
const readPage = (id: string) => {
  try {
    const n = Number(window.localStorage.getItem(pageKey(id)));
    return Number.isInteger(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
};
const writePage = (id: string, n: number) => {
  try {
    window.localStorage.setItem(pageKey(id), String(n));
  } catch {
    /* not important */
  }
};

export default function RouteViewer({
  route,
  active,
  isSaved,
  onSaved,
  jump,
}: {
  route: SnowRoute;
  active: boolean;
  isSaved: boolean;
  onSaved: () => void;
  jump: Jump | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PdfJs>(null);
  const taskRef = useRef<PdfJs>(null);
  const [state, setState] = useState<{ kind: "loading" | "ready" | "error"; msg?: string }>({ kind: "loading" });
  const [sizes, setSizes] = useState<{ w: number; h: number }[] | null>(null);
  const [page, setPage] = useState(() => (jump ? jump.page : readPage(route.id)));
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const doneJump = useRef(jump?.n ?? 0);
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;

  const pageCount = sizes?.length ?? 0;
  const stop = route.stops.find((x) => x.page === page) ?? null;

  const goPage = (n: number, scroll = false) => {
    const max = pageCount || n;
    const next = Math.max(1, Math.min(max, n));
    setPage(next);
    writePage(route.id, next);
    if (scroll && !full) wrapRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  // download (or read from the phone) and open the PDF
  useEffect(() => {
    if (!active || docRef.current) return;
    let cancelled = false;
    let url: string | null = null;
    setState({ kind: "loading", msg: isSaved ? "Opening route…" : `Downloading route${route.size ? ` (${fmtSize(route.size)})` : ""}…` });
    (async () => {
      const [{ bytes, fromPhone }, pdfjs] = await Promise.all([getRouteBytes(route.id), loadPdfJs()]);
      if (cancelled) return;
      if (!fromPhone) savedRef.current();
      url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      setBlobUrl(url);
      // pdf.js takes over the buffer it is given, so hand it a copy
      const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
      const doc = await task.promise;
      const dims: { w: number; h: number }[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
        dims.push({ w: vp.width, h: vp.height });
      }
      if (cancelled) {
        void task.destroy?.();
        return;
      }
      docRef.current = doc;
      taskRef.current = task;
      setSizes(dims);
      setPage((p) => Math.max(1, Math.min(dims.length, p)));
      setState({ kind: "ready" });
    })().catch((e) => !cancelled && setState({ kind: "error", msg: errMsg(e) }));
    return () => {
      cancelled = true;
      if (url && !docRef.current) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.id, active, attempt]);

  useEffect(
    () => () => {
      void taskRef.current?.destroy?.();
      taskRef.current = null;
      docRef.current = null;
    },
    [],
  );
  useEffect(() => () => void (blobUrl && URL.revokeObjectURL(blobUrl)), [blobUrl]);

  // go to a page (a stop was tapped, or the crew just arrived at one)
  useEffect(() => {
    if (!jump || jump.n === doneJump.current) return;
    doneJump.current = jump.n;
    goPage(jump.page, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);

  // follow the box width (rotating the phone, full screen, the tab being shown again)
  useEffect(() => {
    const el = pageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let t = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setWidth(el.clientWidth), 120);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, [state.kind, full]);

  // draw the one page on screen
  useEffect(() => {
    const doc = docRef.current;
    const el = pageRef.current;
    if (state.kind !== "ready" || !doc || !el || !sizes || width < 50 || page > sizes.length) return;
    let live = true;
    const sz = sizes[page - 1];
    const cssWidth = Math.floor((width - 2) * zoom);
    const slot = document.createElement("div");
    slot.className = s.slot;
    slot.dataset.page = String(page);
    slot.style.width = `${cssWidth}px`;
    slot.style.height = `${Math.round((cssWidth * sz.h) / sz.w)}px`;
    slot.setAttribute("role", "img");
    slot.setAttribute("aria-label", `${route.name}, page ${page} of ${sizes.length}`);
    const old = el.firstChild as HTMLElement | null;
    const keepX = el.scrollWidth > el.clientWidth ? (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth : 0.5;
    const keepY = el.scrollHeight > el.clientHeight ? (el.scrollTop + el.clientHeight / 2) / el.scrollHeight : 0;
    const samePage = old?.dataset.page === String(page);

    (async () => {
      const pg = await doc.getPage(page);
      const base = pg.getViewport({ scale: 1 });
      const cssScale = cssWidth / base.width;
      let px = cssScale * Math.min(window.devicePixelRatio || 1, 3);
      const area = base.width * base.height * px * px;
      if (area > MAX_CANVAS_PX) px *= Math.sqrt(MAX_CANVAS_PX / area);
      const vp = pg.getViewport({ scale: px });
      const cv = document.createElement("canvas");
      cv.width = Math.floor(vp.width);
      cv.height = Math.floor(vp.height);
      cv.style.width = "100%";
      cv.style.height = "100%";
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      if (!live) {
        cv.width = cv.height = 0;
        return;
      }
      slot.appendChild(cv);
      const oldCv = old?.querySelector("canvas");
      if (oldCv) oldCv.width = oldCv.height = 0; // give the phone the memory back
      el.replaceChildren(slot);
      if (samePage) {
        // zooming: stay on the same spot of the map
        el.scrollLeft = Math.max(0, keepX * el.scrollWidth - el.clientWidth / 2);
        el.scrollTop = Math.max(0, keepY * el.scrollHeight - el.clientHeight / 2);
      } else {
        el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
        el.scrollTop = 0;
      }
    })().catch((e) => live && setState({ kind: "error", msg: `Could not show this page: ${errMsg(e)}` }));
    return () => {
      live = false;
    };
  }, [state.kind, sizes, width, zoom, page, route.name]);

  // swipe left / right to change page (only when not zoomed in, so panning the map still works)
  useEffect(() => {
    const el = pageRef.current;
    if (!el || state.kind !== "ready") return;
    let x0 = 0;
    let y0 = 0;
    let t0 = 0;
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      t0 = Date.now();
    };
    const end = (e: TouchEvent) => {
      if (zoom > 1 || !t0) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      t0 = 0;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 50) goPage(page + (dx < 0 ? 1 : -1));
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchend", end, { passive: true });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchend", end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, zoom, page, pageCount]);

  // keyboard: arrows change page, Escape leaves full screen
  useEffect(() => {
    if (state.kind !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape" && full) setFull(false);
      else if (e.key === "ArrowRight" && (full || wrapRef.current?.contains(document.activeElement))) goPage(page + 1);
      else if (e.key === "ArrowLeft" && (full || wrapRef.current?.contains(document.activeElement))) goPage(page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, full, page, pageCount]);

  const zoomTo = (z: number) => setZoom(Math.max(1, Math.min(5, Math.round(z * 100) / 100)));
  const ready = state.kind === "ready";

  return (
    <div ref={wrapRef} className={full ? s.full : s.viewer} data-testid="snow-viewer">
      {ready && pageCount > 1 && (
        <div className={s.pager} data-testid="snow-pager">
          <button type="button" className={`${g.btn} ${g.sec}`} disabled={page <= 1} onClick={() => goPage(page - 1)} aria-label="Previous page" data-testid="snow-prev">
            ‹ Prev
          </button>
          <div className={s.pagerLabel}>
            <span className={s.pagerTitle} data-testid="snow-page-title">
              {stop ? stop.title : `Page ${page}`}
            </span>
            <span className={s.pageChip} data-testid="snow-page-chip">
              Page {page} of {pageCount}
            </span>
          </div>
          <button type="button" className={`${g.btn} ${g.sec}`} disabled={page >= pageCount} onClick={() => goPage(page + 1)} aria-label="Next page" data-testid="snow-next">
            Next ›
          </button>
        </div>
      )}
      <div className={s.toolbar}>
        <button type="button" className={`${g.btn} ${g.sec} ${s.zoom}`} aria-label="Zoom out" disabled={!ready || zoom <= 1} onClick={() => zoomTo(zoom / 1.5)}>
          −
        </button>
        <span className={s.zoomVal} data-testid="snow-zoom">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" className={`${g.btn} ${g.sec} ${s.zoom}`} aria-label="Zoom in" disabled={!ready || zoom >= 5} onClick={() => zoomTo(zoom * 1.5)}>
          +
        </button>
        {zoom > 1 && (
          <button type="button" className={`${g.btn} ${g.sec}`} onClick={() => setZoom(1)}>
            Fit
          </button>
        )}
        <span className={s.spacer} />
        <button type="button" className={`${g.btn} ${g.sec}`} onClick={() => setFull((f) => !f)} disabled={!ready} data-testid="snow-full">
          {full ? "Close" : "Full screen"}
        </button>
        {blobUrl && !full && (
          <a className={`${g.btn} ${g.sec} ${s.openLink}`} href={`${blobUrl}#page=${page}`} target="_blank" rel="noopener">
            Open PDF
          </a>
        )}
      </div>
      {isSaved && !full && ready && <p className={s.saved}>Saved on this phone</p>}
      {!ready && (
        <div className={`${s.status} ${state.kind === "error" ? s.err : ""}`} data-testid="snow-viewer-status">
          {state.msg}
          {state.kind === "error" && (
            <>
              {" "}
              <button
                type="button"
                className={g.linkbtn}
                onClick={() => {
                  void taskRef.current?.destroy?.();
                  taskRef.current = null;
                  docRef.current = null;
                  setAttempt((a) => a + 1);
                }}
              >
                Try again
              </button>
            </>
          )}
        </div>
      )}
      <div ref={pageRef} className={s.pages} hidden={!ready} data-testid="snow-pages" />
    </div>
  );
}
