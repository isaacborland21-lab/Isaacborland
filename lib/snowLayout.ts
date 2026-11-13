// Turns one route-PDF page into a phone-sized "big view": the instructions as real text (so they can be
// shown large), and each picture / drawing cut out of the page so it can fill the screen width.
// Pure logic, no browser APIs: app/snow/pdf.ts gathers the inputs (text, picture positions, and a small
// black-and-white "ink" mask of the page), and the tests feed it synthetic ones.
//
// How a page is split:
//   - Text lines that sit beside or on top of a picture (callouts) stay part of the picture.
//   - The heading (shown above the page already) and the page number are left out.
//   - Every other text line is an instruction line; lines are joined into paragraphs and bullet points.
//   - Whatever ink is left on the page between the instruction lines (pictures, drawings, callouts that
//     stick out past a picture) becomes a figure, trimmed to the ink.

import { PdfTextBit, findHeading } from "./snow";

/** A box on the page in PDF points, measured from the top-left corner. */
export type Rect = { left: number; top: number; right: number; bottom: number };

/** The page at low resolution: data[y * w + x] is 1 where the page isn't white. One mask pixel = 1/scale points. */
export type InkMask = { w: number; h: number; scale: number; data: Uint8Array };

export type Run = { text: string; bold: boolean };
export type Para = { top: number; bullet: boolean; swatch: string | null; runs: Run[] };
export type Block = { kind: "text"; top: number; paras: Para[] } | { kind: "figure"; top: number; rect: Rect };

const BULLET = /^[●•◦○▪■◆➢➤‣·\-–*]$/;
const NUMBERED = /^(\d{1,2}[.)]|[a-z][.)])$/i;

/** Colors named in a route's key ("Yellow: parking lot…") get a color chip next to the word. */
const KEY_COLORS: Record<string, string> = {
  yellow: "#f2d21b",
  red: "#e53935",
  blue: "#3b82f6",
  green: "#43a047",
  orange: "#fb8c00",
  purple: "#8e44ad",
  pink: "#ec6fa8",
  black: "#111111",
  white: "#ffffff",
};

type Line = { top: number; size: number; bits: PdfTextBit[] };

function groupLines(bits: PdfTextBit[]): Line[] {
  const sorted = bits.filter((b) => b.str.trim() && b.size > 0).sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: Line[] = [];
  for (const b of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(b.top - last.top) <= Math.max(2, Math.min(b.size, last.size) * 0.35)) {
      last.bits.push(b);
      last.size = Math.max(last.size, b.size);
    } else lines.push({ top: b.top, size: b.size, bits: [b] });
  }
  for (const l of lines) l.bits.sort((a, b) => a.left - b.left);
  return lines;
}

/** Pictures that touch or nearly touch are one figure (a photo with callout boxes pasted over it). */
export function clusterRects(rects: Rect[], gap = 10): Rect[] {
  const out: Rect[] = rects.filter((r) => r.right - r.left > 1 && r.bottom - r.top > 1).map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        if (a.left - gap <= b.right && b.left - gap <= a.right && a.top - gap <= b.bottom && b.top - gap <= a.bottom) {
          out[i] = { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
          out.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  return out;
}

/** The size most of the page's text is written in (by letter count). */
function bodySize(lines: Line[]): number {
  const count = new Map<number, number>();
  for (const l of lines) for (const b of l.bits) count.set(Math.round(b.size), (count.get(Math.round(b.size)) ?? 0) + b.str.length);
  let best = 12;
  let n = -1;
  count.forEach((v, k) => {
    if (v > n) {
      n = v;
      best = k;
    }
  });
  return best;
}

function lineRuns(line: Line, isBold: (b: PdfTextBit) => boolean): Run[] {
  const runs: Run[] = [];
  let prev: PdfTextBit | null = null;
  for (const b of line.bits) {
    const bold = isBold(b);
    // pdf.js splits a line wherever the font changes; only add a space where there is a visible gap
    const gap = prev && prev.width !== undefined ? b.left - (prev.left + prev.width) : Infinity;
    const space = prev !== null && gap > Math.min(b.size, prev.size) * 0.12 && !/\s$/.test(prev.str) && !/^\s/.test(b.str);
    const last = runs[runs.length - 1];
    if (last && last.bold === bold) last.text += (space ? " " : "") + b.str;
    else if (space && bold && last) {
      last.text += " "; // plain → bold: the space stays with the plain word before it
      runs.push({ text: b.str, bold });
    } else if (space && !bold) {
      runs.push({ text: " " + b.str, bold }); // bold → plain: the space starts the plain word
    } else {
      runs.push({ text: b.str, bold });
    }
    prev = b;
  }
  return runs;
}

function addRuns(into: Run[], more: Run[]) {
  for (const r of more) {
    const last = into[into.length - 1];
    if (last && last.bold === r.bold) last.text += r.text;
    else into.push({ ...r });
  }
}

function tidy(runs: Run[]): Run[] {
  const out = runs.map((r) => ({ ...r, text: r.text.replace(/\s+/g, " ") })).filter((r) => r.text !== "");
  if (out.length) {
    out[0].text = out[0].text.replace(/^\s+/, "");
    out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, "");
  }
  return out.filter((r) => r.text !== "");
}

/** Instruction lines → paragraphs and bullet points, in reading order. */
function paragraphs(lines: Line[], isBold: (b: PdfTextBit) => boolean): Para[] {
  const paras: Para[] = [];
  let prev: Line | null = null;
  for (const line of lines) {
    const first = line.bits[0].str.trim();
    const bullet = line.bits.length > 1 && (BULLET.test(first) || NUMBERED.test(first));
    const body: Line = bullet && BULLET.test(first) ? { ...line, bits: line.bits.slice(1) } : line;
    const runs = lineRuns(body, isBold);
    const cur = paras[paras.length - 1];
    const close = prev !== null && line.top - prev.top <= Math.max(line.size, prev.size) * 1.5;
    if (cur && close && !bullet) {
      addRuns(cur.runs, [{ text: " ", bold: runs[0]?.bold ?? false }, ...runs]);
    } else {
      paras.push({ top: line.top, bullet, swatch: null, runs });
    }
    prev = line;
  }
  for (const p of paras) {
    p.runs = tidy(p.runs);
    const m = p.runs.map((r) => r.text).join("").match(/^([A-Za-z]+)\s*:/);
    if (m && KEY_COLORS[m[1].toLowerCase()]) {
      p.swatch = KEY_COLORS[m[1].toLowerCase()];
      // make the color's name bold even when the PDF didn't ("Blue: SR Mag Routes")
      const label = m[0];
      const text = p.runs.map((r) => r.text).join("");
      const rest: Run[] = [];
      let skip = label.length;
      for (const r of p.runs) {
        if (skip >= r.text.length) {
          skip -= r.text.length;
          continue;
        }
        rest.push({ text: r.text.slice(skip), bold: r.bold });
        skip = 0;
      }
      p.runs = [{ text: text.slice(0, label.length), bold: true }, ...rest].filter((r) => r.text !== "");
    }
  }
  return paras.filter((p) => p.runs.length > 0);
}

export type PageInput = {
  width: number;
  height: number;
  bits: PdfTextBit[];
  images: Rect[];
  ink: InkMask | null;
};

/**
 * The big view of one page, top to bottom. An empty result means "nothing recognisable": show the whole page.
 */
export function layoutPage(page: PageInput): Block[] {
  const { width, height } = page;
  const lines = groupLines(page.bits);
  const heading = findHeading(page.bits, height);
  const atHeading = (l: Line) => !!heading && heading.tops.some((t) => Math.abs(t - l.top) <= 1);
  const isPageNo = (l: Line) => l.top > height * 0.88 && /^\s*(page\s*)?\d{1,3}(\s*(of|\/)\s*\d{1,3})?\s*$/i.test(l.bits.map((b) => b.str).join(" "));
  // only strip the heading from the instructions when it stands out from the body text below it; on a page
  // whose text is all one size there is no separate heading to remove (every line is an instruction), but a
  // page with nothing under the heading (just a picture) is a heading + picture
  const belowHeading = lines.filter((l) => !atHeading(l) && !isPageNo(l));
  const headingSize = heading ? Math.max(...lines.filter(atHeading).map((l) => l.size), 0) : 0;
  const band = (l: Line) => ({ top: l.top - l.size * 1.0, bottom: l.top + l.size * 0.35 });
  // is there anything drawn on the page besides the text? (a photo or a map). Operator-list images are the
  // clearest sign; failing that, ink sitting in rows that hold no text line.
  const allBands = lines.map(band);
  const hasGraphic =
    page.images.some((r) => r.right - r.left >= 24 && r.bottom - r.top >= 24) ||
    (!!page.ink &&
      (() => {
        const ink = page.ink;
        const pt = 1 / ink.scale;
        for (let y = 0; y < ink.h; y++) {
          const yPt = (y + 0.5) * pt;
          if (allBands.some((bd) => yPt >= bd.top && yPt <= bd.bottom)) continue;
          const row = y * ink.w;
          let run = 0;
          for (let x = 0; x < ink.w; x++) {
            if (ink.data[row + x] && ++run >= Math.round(24 * ink.scale)) return true;
            else if (!ink.data[row + x]) run = 0;
          }
        }
        return false;
      })());
  // strip the heading from the instructions only when it stands out from body text below it, or when there is
  // nothing below it but a picture (a picture-only page); on an all-text page every line is an instruction
  const hasHeading = !!heading && (belowHeading.length > 0 ? headingSize >= bodySize(belowHeading) * 1.2 : hasGraphic);
  const isHeading = (l: Line) => hasHeading && atHeading(l);

  const pics = clusterRects(page.images.filter((r) => r.right - r.left >= 24 && r.bottom - r.top >= 24));
  const inPicture = (l: Line) => {
    const mid = l.top - l.size * 0.35;
    return pics.some((r) => mid >= r.top - 2 && mid <= r.bottom + 2);
  };

  const instr = lines.filter((l) => !isHeading(l) && !isPageNo(l) && !inPicture(l));
  const textBands = lines.filter((l) => !inPicture(l)).map(band);

  // ---------- figures: whatever ink is left between the text lines ----------
  const figures: Rect[] = [];
  const ink = page.ink;
  if (ink && ink.w > 0 && ink.h > 0) {
    const pt = 1 / ink.scale; // points per mask pixel
    const rowInk = new Uint8Array(ink.h);
    for (let y = 0; y < ink.h; y++) {
      const yPt = (y + 0.5) * pt;
      if (textBands.some((b) => yPt >= b.top && yPt <= b.bottom)) continue; // a text line: not a figure
      if (pics.some((r) => yPt >= r.top && yPt <= r.bottom)) {
        rowInk[y] = 1;
        continue;
      }
      const row = y * ink.w;
      for (let x = 0; x < ink.w; x++) {
        if (ink.data[row + x]) {
          rowInk[y] = 1;
          break;
        }
      }
    }
    const blocked = (y: number) => {
      const yPt = (y + 0.5) * pt;
      return textBands.some((b) => yPt >= b.top && yPt <= b.bottom);
    };
    // runs of inked rows; small white gaps inside a drawing don't split it, a text line does
    const maxGap = Math.round(12 * ink.scale);
    let y = 0;
    while (y < ink.h) {
      if (!rowInk[y]) {
        y++;
        continue;
      }
      let end = y;
      let scan = y + 1;
      let gap = 0;
      while (scan < ink.h) {
        if (rowInk[scan]) {
          end = scan;
          gap = 0;
        } else if (blocked(scan) || ++gap > maxGap) break;
        scan++;
      }
      const top = y * pt;
      const bottom = (end + 1) * pt;
      const touchesPic = pics.some((r) => r.top < bottom && r.bottom > top);
      if (bottom - top >= 8 || touchesPic) {
        let left = ink.w;
        let right = -1;
        for (let yy = y; yy <= end; yy++) {
          const row = yy * ink.w;
          for (let x = 0; x < left; x++) {
            if (ink.data[row + x]) {
              left = x;
              break;
            }
          }
          for (let x = ink.w - 1; x > right; x--) {
            if (ink.data[row + x]) {
              right = x;
              break;
            }
          }
        }
        let rect: Rect | null = right >= left ? { left: left * pt, top, right: (right + 1) * pt, bottom } : null;
        for (const r of pics) {
          if (r.top < bottom && r.bottom > top) {
            rect = rect
              ? { left: Math.min(rect.left, r.left), top: Math.min(rect.top, r.top), right: Math.max(rect.right, r.right), bottom: Math.max(rect.bottom, r.bottom) }
              : { ...r };
          }
        }
        // a thin, short mark (a stray rule or dot) isn't worth a figure
        if (rect && (touchesPic || (rect.right - rect.left >= 24 && rect.bottom - rect.top >= 8))) figures.push(rect);
      }
      y = end + 1;
    }
  } else {
    figures.push(...pics);
  }

  const pad = 3;
  const figs: Block[] = figures.map((r) => {
    const rect = {
      left: Math.max(0, r.left - pad),
      top: Math.max(0, r.top - pad),
      right: Math.min(width, r.right + pad),
      bottom: Math.min(height, r.bottom + pad),
    };
    return { kind: "figure" as const, top: rect.top, rect };
  });

  // ---------- instructions ----------
  const body = bodySize(instr);
  // the heading's font is the PDF's bold face; use it to spot bold words, but only when there's a real heading
  const boldFont = hasHeading ? heading!.font : null;
  const isBold = (b: PdfTextBit) => (!!boldFont && b.font === boldFont) || b.size >= body * 1.25;
  const paras = paragraphs(instr, isBold);

  // ---------- interleave, top to bottom ----------
  const items: ({ top: number; para: Para } | { top: number; fig: Block })[] = [
    ...paras.map((p) => ({ top: p.top, para: p })),
    ...figs.map((f) => ({ top: f.top, fig: f })),
  ].sort((a, b) => a.top - b.top);
  const blocks: Block[] = [];
  for (const it of items) {
    if ("fig" in it) blocks.push(it.fig);
    else {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "text") last.paras.push(it.para);
      else blocks.push({ kind: "text", top: it.top, paras: [it.para] });
    }
  }
  return blocks;
}
