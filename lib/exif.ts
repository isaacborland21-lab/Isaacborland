/**
 * Reads where and when a JPEG photo was taken from its EXIF data (GPS position + date), in the browser,
 * BEFORE the photo is shrunk (shrinking redraws it on a canvas, which drops EXIF).
 *
 * Phones only keep a location in a photo when the camera was allowed to save one, and some browsers or
 * photo pickers remove it when a photo is chosen. So "no location" is normal and never an error.
 * Only the first 256 KB of the file are read: EXIF sits at the very start.
 */

export type PhotoMeta = {
  lat?: number;
  lng?: number;
  /** The calendar day it was taken, "YYYY-MM-DD" (the camera's own clock, no time zone). */
  day?: string;
};

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** Parses the EXIF block of a JPEG. Null when there is none (or it is not a JPEG / is damaged). */
export function parseExif(buf: ArrayBuffer): PhotoMeta | null {
  try {
    const v = new DataView(buf);
    const len = v.byteLength;
    if (len < 4 || v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    let tiff = -1;
    while (off + 4 <= len) {
      if (v.getUint8(off) !== 0xff) break;
      const marker = v.getUint8(off + 1);
      if (marker === 0xda || marker === 0xd9) break; // start of image data
      const size = v.getUint16(off + 2);
      if (marker === 0xe1 && off + 10 <= len && v.getUint32(off + 4) === 0x45786966 && v.getUint16(off + 8) === 0) {
        tiff = off + 10; // "Exif\0\0"
        break;
      }
      off += 2 + size;
    }
    if (tiff < 0) return null;

    const little = v.getUint16(tiff) === 0x4949;
    if (!little && v.getUint16(tiff) !== 0x4d4d) return null;
    const u16 = (p: number) => v.getUint16(p, little);
    const u32 = (p: number) => v.getUint32(p, little);
    if (u16(tiff + 2) !== 42) return null;

    type Entry = { type: number; count: number; data: number; entry: number };
    const readIfd = (rel: number): Map<number, Entry> => {
      const out = new Map<number, Entry>();
      const start = tiff + rel;
      if (rel <= 0 || start + 2 > len) return out;
      const n = Math.min(u16(start), 400);
      for (let i = 0; i < n; i++) {
        const e = start + 2 + i * 12;
        if (e + 12 > len) break;
        const type = u16(e + 2);
        const count = u32(e + 4);
        const bytes = (TYPE_SIZE[type] ?? 1) * count;
        const data = bytes <= 4 ? e + 8 : tiff + u32(e + 8);
        out.set(u16(e), { type, count, data, entry: e });
      }
      return out;
    };
    const ascii = (e: Entry | undefined): string => {
      if (!e || e.type !== 2 || e.data + e.count > len) return "";
      let s = "";
      for (let i = 0; i < e.count; i++) {
        const c = v.getUint8(e.data + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    };
    const rationals = (e: Entry | undefined, n: number): number[] | null => {
      if (!e || e.type !== 5 || e.count < n || e.data + n * 8 > len) return null;
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const den = u32(e.data + i * 8 + 4);
        if (den === 0) return null;
        out.push(u32(e.data + i * 8) / den);
      }
      return out;
    };

    const ifd0 = readIfd(u32(tiff + 4));
    const meta: PhotoMeta = {};

    // GPS position
    const gpsPtr = ifd0.get(0x8825);
    if (gpsPtr) {
      const gps = readIfd(u32(gpsPtr.entry + 8));
      const lat = rationals(gps.get(2), 3);
      const lng = rationals(gps.get(4), 3);
      if (lat && lng) {
        let la = lat[0] + lat[1] / 60 + lat[2] / 3600;
        let lo = lng[0] + lng[1] / 60 + lng[2] / 3600;
        if (ascii(gps.get(1)).toUpperCase().startsWith("S")) la = -la;
        if (ascii(gps.get(3)).toUpperCase().startsWith("W")) lo = -lo;
        // (0, 0) is what cameras write when they had no fix at all
        if (Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0)) {
          meta.lat = Math.round(la * 1e6) / 1e6;
          meta.lng = Math.round(lo * 1e6) / 1e6;
        }
      }
    }

    // the day it was taken: DateTimeOriginal, else Digitized, else the file's DateTime
    const exifPtr = ifd0.get(0x8769);
    const exifIfd = exifPtr ? readIfd(u32(exifPtr.entry + 8)) : new Map<number, Entry>();
    for (const raw of [ascii(exifIfd.get(0x9003)), ascii(exifIfd.get(0x9004)), ascii(ifd0.get(0x0132))]) {
      const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(raw);
      if (m && Number(m[1]) >= 2000 && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31) {
        meta.day = `${m[1]}-${m[2]}-${m[3]}`;
        break;
      }
    }
    return meta.lat !== undefined || meta.day !== undefined ? meta : null;
  } catch {
    return null;
  }
}

/** Where / when a chosen photo was taken, or null (no EXIF, not a JPEG, location removed by the phone). Never throws. */
export async function readPhotoMeta(file: Blob): Promise<PhotoMeta | null> {
  try {
    return parseExif(await file.slice(0, 256 * 1024).arrayBuffer());
  } catch {
    return null;
  }
}
