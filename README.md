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

**Reporting and using it on several phones**

- Anyone with the graffiti tab can **report** a tag (Log new → *Report it*): a photo
  of the tag, an optional **Urgent** flag, and their name is recorded. Whoever
  removes it opens it from the list, taps **I'll take this** (so two people do
  not both drive out), then uses the normal before/after photos.
- Everyone's list refreshes every 15 seconds and shows a toast for new reports
  (urgent ones are called out). The **Needs removal** filter lists open reports,
  urgent first. There are no push, text or email alerts, only what shows in the app.
- Someone else can take over a claimed job; only the person who took it (or the
  owner) can give it back.
- Existing installs: re-run `supabase/graffiti.sql`. It adds the new columns and is safe to re-run.

**Google Sheets invoice (one section per crew member)**

- Each finished tag is credited to whoever took the job (else whoever finished it,
  else whoever reported/logged it), using the name on their login. The on-screen
  invoice and the CSV group by that person with a subtotal each.
- The crew record the **type of tag** (Slap tag, Chalk pen, Sharpie, Spray paint, Other), **what it is on** and the
  **chemical used** (boxes: SSR, Bare brick, Paint over, Razor, Other). Choosing *Other* on the tag type, what it's on or the chemical opens a box to type it in. They are in the CSV, and the tag type fills the sheet's *Graffiti type* column
  (so the line reads "Graffiti Removal at Main St, Slap tag on Electrical box").
- Invoice page → *Google Sheets invoice*: upload your own invoice sheet **once**
  (Google Sheets → File → Download → Microsoft Excel .xlsx). It is kept in the
  private `graffiti` bucket, not in this repo (it has your logo and letterhead).
  After that, *Download for Google Sheets* builds the month in that exact layout;
  open it in Drive with Google Sheets. Re-upload only if you change the layout.
- The sheet always bills in half-hour steps with a half-hour minimum (that is what
  the template's formulas do). To make the on-screen invoice match, set
  *Round time up to nearest* to 30 min in Billing settings.
- Sections are written into the file when you download it. If you edit jobs in the
  sheet afterwards, it will not regroup; fix the job in the tracker and download again.
- Existing installs: re-run `supabase/graffiti.sql` (adds the new columns and lets
  the bucket accept .xlsx).
- **Letting crew use the invoice**: Admin tab → tick **graffiti invoice** for that person
  (they also need the graffiti tab). They then get an *Invoice* link in the tracker and can
  view the invoice, print/download it (PDF, CSV, Google Sheets) and mark a month invoiced.
  Billing settings, the template upload and "undo invoiced" stay owner-only.
- **Required before a photo**: what it's on and the chemical used must be filled in before the
  before photo (or the after photo / starting or finishing without a photo). The tag type always
  has a value. A report only needs what it's on, since nothing has been removed yet.
  The server enforces this too, not just the form.

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
