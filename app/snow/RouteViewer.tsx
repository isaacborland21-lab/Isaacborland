"use client";

import { useEffect, useRef, useState } from "react";
import g from "../graffiti/graffiti.module.css";
import s from "./snow.module.css";
import { SnowRoute, fmtSize } from "@/lib/snow";
import { PdfJs, errMsg, getRouteBytes, loadPdfJs } from "./pdf";

// The route PDF on screen, with zoom, full screen and "go to page" for stops.
// Only the pages on or near the screen are drawn: a route with a dozen full-page aerial photos would
// otherwise use more memory than a phone has once zoomed in. Pages scrolled far away are dropped and
// redrawn when they come back.

/** Phones refuse canvases above ~16 million pixels (iPhone Safari) and draw them blank, so stay under it. */
const MAX_CANVAS_PX = 16_000_000;

export type Jump = { page: number; n: number }; // n changes on every request, so the same page can be asked for twice

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
  const pagesRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PdfJs>(null);
  const taskRef = useRef<PdfJs>(null);
  const [state, setState] = useState<{ kind: "loading" | "ready" | "error"; msg?: string }>({ kind: "loading" });
  const [sizes, setSizes] = useState<{ w: number; h: number }[] | null>(null);
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [laidOut, setLaidOut] = useState(0);
  const [curPage, setCurPage] = useState(1);
  const pendingJump = useRef<Jump | null>(null);
  const doneJump = useRef(0);
  const savedRef = useRef(onSaved);
  savedRef.current = onSaved;

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

  // follow the box width (rotating the phone, full screen, the tab being shown again)
  useEffect(() => {
    const el = pagesRef.current;
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

  // lay out one empty slot per page at the right size, then draw the slots near the screen
  useEffect(() => {
    const doc = docRef.current;
    const el = pagesRef.current;
    if (state.kind !== "ready" || !doc || !el || !sizes || width < 50) return;
    let live = true;
    const cssWidth = Math.floor((width - 2) * zoom);
    const keepX = el.scrollWidth > el.clientWidth ? (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth : 0.5;
    const keepY = el.scrollHeight > el.clientHeight ? el.scrollTop / el.scrollHeight : 0;

    const slots = sizes.map((sz, i) => {
      const d = document.createElement("div");
      d.className = s.slot;
      d.dataset.page = String(i + 1);
      d.style.width = `${cssWidth}px`;
      d.style.height = `${Math.round((cssWidth * sz.h) / sz.w)}px`;
      d.setAttribute("role", "img");
      d.setAttribute("aria-label", `${route.name}, page ${i + 1} of ${sizes.length}`);
      return d;
    });
    el.replaceChildren(...slots);
    el.scrollLeft = Math.max(0, keepX * el.scrollWidth - el.clientWidth / 2);
    el.scrollTop = keepY * el.scrollHeight;

    const wanted = new Set<number>();
    let chain = Promise.resolve();
    const draw = (slot: HTMLDivElement, n: number) => {
      chain = chain.then(async () => {
        if (!live || !wanted.has(n) || slot.firstChild) return;
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const cssScale = cssWidth / base.width;
        let px = cssScale * Math.min(window.devicePixelRatio || 1, 3);
        const area = base.width * base.height * px * px;
        if (area > MAX_CANVAS_PX) px *= Math.sqrt(MAX_CANVAS_PX / area);
        const vp = page.getViewport({ scale: px });
        const cv = document.createElement("canvas");
        cv.width = Math.floor(vp.width);
        cv.height = Math.floor(vp.height);
        cv.style.width = "100%";
        cv.style.height = "100%";
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        if (live && wanted.has(n)) slot.replaceChildren(cv);
        else cv.width = cv.height = 0; // let the phone have the memory back
      }).catch((e) => {
        if (live) setState({ kind: "error", msg: `Could not show this PDF: ${errMsg(e)}` });
      });
    };

    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "undefined") {
      slots.forEach((slot, i) => {
        wanted.add(i + 1);
        draw(slot, i + 1);
      });
    } else {
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const slot = e.target as HTMLDivElement;
            const n = Number(slot.dataset.page);
            if (e.isIntersecting) {
              wanted.add(n);
              draw(slot, n);
            } else {
              wanted.delete(n);
              const cv = slot.firstChild as HTMLCanvasElement | null;
              if (cv) {
                cv.width = cv.height = 0;
                slot.replaceChildren();
              }
            }
          }
        },
        { root: el, rootMargin: "120% 60% 120% 60%" },
      );
      slots.forEach((slot) => io!.observe(slot));
    }
    setLaidOut((v) => v + 1);
    return () => {
      live = false;
      io?.disconnect();
    };
  }, [state.kind, sizes, width, zoom, route.name]);

  // which page is on screen (for "Page 3 of 11")
  useEffect(() => {
    const el = pagesRef.current;
    if (!el || state.kind !== "ready") return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const mark = el.scrollTop + el.clientHeight / 2;
        let page = 1;
        for (const c of Array.from(el.children) as HTMLElement[]) if (c.offsetTop <= mark) page = Number(c.dataset.page) || page;
        setCurPage(page);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [state.kind, laidOut]);

  // go to a page (a stop was tapped, or the crew just arrived at one)
  useEffect(() => {
    if (jump && jump.n !== doneJump.current) pendingJump.current = jump;
    const want = pendingJump.current;
    const el = pagesRef.current;
    if (!want || !el || state.kind !== "ready" || laidOut === 0) return;
    const slot = el.querySelector<HTMLElement>(`[data-page="${want.page}"]`);
    if (!slot) return;
    pendingJump.current = null;
    doneJump.current = want.n;
    el.scrollTop = slot.offsetTop;
    setCurPage(want.page);
    if (!full) wrapRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [jump, laidOut, state.kind, full]);

  // Escape leaves full screen
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const zoomTo = (z: number) => setZoom(Math.max(1, Math.min(5, Math.round(z * 100) / 100)));
  const pageCount = sizes?.length ?? 0;

  return (
    <div ref={wrapRef} className={full ? s.full : s.viewer} data-testid="snow-viewer">
      <div className={s.toolbar}>
        <button type="button" className={`${g.btn} ${g.sec} ${s.zoom}`} aria-label="Zoom out" disabled={state.kind !== "ready" || zoom <= 1} onClick={() => zoomTo(zoom / 1.5)}>
          −
        </button>
        <span className={s.zoomVal} data-testid="snow-zoom">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" className={`${g.btn} ${g.sec} ${s.zoom}`} aria-label="Zoom in" disabled={state.kind !== "ready" || zoom >= 5} onClick={() => zoomTo(zoom * 1.5)}>
          +
        </button>
        {zoom > 1 && (
          <button type="button" className={`${g.btn} ${g.sec}`} onClick={() => setZoom(1)}>
            Fit
          </button>
        )}
        <span className={s.spacer} />
        {pageCount > 1 && (
          <span className={s.pageChip} data-testid="snow-page-chip">
            Page {curPage} of {pageCount}
          </span>
        )}
        <button type="button" className={`${g.btn} ${g.sec}`} onClick={() => setFull((f) => !f)} disabled={state.kind !== "ready"} data-testid="snow-full">
          {full ? "Close" : "Full screen"}
        </button>
        {blobUrl && !full && (
          <a className={`${g.btn} ${g.sec} ${s.openLink}`} href={blobUrl} target="_blank" rel="noopener">
            Open PDF
          </a>
        )}
      </div>
      {isSaved && !full && state.kind === "ready" && <p className={s.saved}>Saved on this phone</p>}
      {state.kind !== "ready" && (
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
      <div ref={pagesRef} className={s.pages} hidden={state.kind !== "ready"} data-testid="snow-pages" />
    </div>
  );
}
