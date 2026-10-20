# Project Hub

Next.js + Clerk (auth) + Supabase (Postgres, for data later). Invite-only —
the homepage itself is the sign-in screen; everything else sits behind it.

## Setup

1. Copy `.env.local.example` to `.env.local` and fill in your Clerk and
   Supabase keys.
2. In your Clerk dashboard: turn OFF public sign-up (Restrictions), then
   invite yourself and anyone else under Users → Invite.
3. `npm install && npm run dev` to test locally.
4. Push to this repo — Vercel is connected and deploys automatically on
   push to `main`.
5. In Vercel: Settings → Domains → add isaacborland.com, then match the
   DNS records it gives you in GoDaddy's DNS management.

## Notes

- The dashboard's project list is currently hardcoded placeholder data —
  swap it for a Supabase query once there's real data to show.
- The homepage IS the login screen (`app/[[...sign-in]]/page.tsx`). There
  is no separate marketing page in front of it.

## Graffiti tab (removal tracker + monthly invoice)

Crew log each tag on their phones. Location is auto-filled from GPS, the timer
starts when the **before** photo is taken and stops when the **after** photo is
taken. The owner prints a monthly invoice for the city from `/graffiti/invoice`.

**One-time setup (the tab will not work until this is done):**

1. Run `supabase/graffiti.sql` in the Supabase SQL editor. It creates the
   `graffiti_incidents`, `graffiti_settings` and `graffiti_invoices` tables
   (RLS on, no policies, so only the server's service-role key can read them)
   and a private `graffiti` photo bucket.
2. Sign in as the owner → **Admin** tab → give each crew member the
   **graffiti** tab. Anyone without it never sees the tab and gets 403s.
3. Open **Graffiti → Invoice** → Billing settings and set the **hourly rate**
   (default is $0 and marking a month invoiced is blocked until it is set),
   business name, bill-to address, PO number and time zone.

**How billing works**

- Each tag bills at least the configured minimum (default 30 min). The actual
  time is always stored and shown next to the billed time, and is in the CSV.
- A tag belongs to the month (in the configured time zone) it was finished in.
- "Mark as invoiced" freezes that month's rate, minimum and tag list. Later
  setting changes never alter it. If a tag is edited afterwards the page flags
  the month as changed, and earlier months never marked invoiced are flagged.
- Only the owner can see or change invoices and settings. A tag on an invoiced
  month cannot be deleted.

**Notes**

- Photos are shrunk in the browser (max 1600px JPEG, GPS/EXIF removed) because
  Vercel limits request bodies to about 4.5 MB. They are served only through
  `/api/graffiti/photo/...` after a sign-in + tab-permission check. Anyone with
  the graffiti tab can view every photo.
- There is no offline queue. If a save fails the photo and its start time stay
  on screen so the crew can retry when they have signal.
- Maps use Leaflet from unpkg and OpenStreetMap tiles; intersection lookup uses
  the free Overpass and Nominatim services (no API keys).
