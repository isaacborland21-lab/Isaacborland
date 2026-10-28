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

## Work orders / Lawn care / Other jobs tabs

Three more field trackers that work like the graffiti one: the crew log a job on their phone,
take a **before** photo (starts the timer) and an **after** photo (stops it). Each tab keeps its
own list, so work orders, lawn care and other jobs never mix. Graffiti is unchanged.

**One-time setup:** run `supabase/jobs.sql` in the Supabase SQL editor (creates the `jobs` table; photos go in
the existing private `graffiti` bucket). Then Admin tab → tick **work orders**, **lawn care** and/or
**other jobs** for each person. **Crew:** anyone who can use the graffiti tracker can also log work orders, lawn
care and other jobs. On the `/crew` page they get four big buttons (Graffiti, Work order, Lawn care, Other job);
Graffiti is the default and works as before, and the phone remembers the last one picked. Crew never see prices
unless you give them that job tab *and* the invoice switch. Graffiti-only crew accounts still land on `/crew`
from the main site; an account that has a job tab is not sent there.

- A job has a **title**, optional **work order #**, a **city** (Helena or Bozeman, required), an address
  (typed, or **Use GPS** to fill it in and pick the city), notes, and before/after photos.
- Three ways to log: **Take before photo** (saves + starts the clock), **Log it without starting**, or
  **Already finished** (type the minutes). Title and city are required before any photo.
- **Billing** is per job: *Hourly*, *Flat price* or *Hours + materials* (a list of materials with amounts).
  Only the owner, or a crew account with the **invoice (prices)** switch on that tab, can see or change
  prices; everyone else never receives them from the server and logs everything as hourly.
- **Invoices** (Owner, or crew with the tab's **invoice (prices)** switch): each tab has an **Invoice →** link to
  `/jobs/<tab>/invoice`. It works like the graffiti invoice: a month per city, finished jobs by the day they were
  finished, a tick box per job, **Mark as invoiced** freezes the total, rate and job list, and the owner can
  undo it. Hourly jobs bill with the tab's rate, minimum and rounding; flat jobs bill their price; hours +
  materials adds the materials list. Each tab (work orders, lawn care, other jobs) has its **own rate and
  Bill to / PO numbers** under *Billing settings* (owner only). Business name, address, terms and time zone
  are shared with the graffiti invoice. Download CSV or print/save as PDF with before/after photos. A job on a
  sent invoice can't be deleted or have its city, status, time or price changed until the invoice is undone.
  Google Sheets (.xlsx) output for jobs is not built yet.
- **Date ranges:** both invoice pages (graffiti and jobs) have a **Month | Date range** switch. Pick any start and end day
  (both included, up to a year) to invoice work finished in between, e.g. Oct 15 - Nov 5. Month invoicing works as before.
  A range invoice keeps its own dates, so it can be viewed, downloaded and undone like any other, and its jobs are
  never offered again on a month view. Run the two `alter table ... add column date_from / date_to` lines at the end of
  `supabase/graffiti.sql` and `supabase/jobs.sql` once (safe to re-run).
- **One more SQL step for invoices:** re-run `supabase/jobs.sql` (it only adds the `job_invoices` table).
- Existing installs: nothing to re-run for graffiti; just add `supabase/jobs.sql`.

## Patrolling and coverage (graffiti)

Crews who drive around looking for graffiti tap **Start patrolling** at the top of the graffiti tracker (crew page or main
site). While it's on, the phone records a point about every 80 m driven and keeps the screen awake (screen wake lock), so
the browser keeps getting GPS; nothing is recorded while it's off. Points queue on the phone and upload every 30 seconds,
so dead zones lose nothing; if the page is closed mid-patrol it offers **Resume**. It stops itself after 10 hours.
Limits of a web page: recording pauses if the phone locks or the crew switch apps (phones without wake lock support
need Auto-Lock set to Never), and it uses battery, so keep the phone on a charger.

- **Crew map:** a time filter (Today / 7 / 30 days), **Color: who did it**, a hover/tap label with who and when, and
  today's patrol routes drawn per crew so crews can see where others have already been.
- **Coverage** (owner only, Graffiti → Coverage →): Bozeman/Helena split into ~300 m blocks, each colored by days since a
  crew drove through it while patrolling or logged a tag there (grey = never). **Check next** lists blocks that get
  tagged but haven't been covered lately (tags in the last year x days since covered). Pick a day to see routes driven.
- Data: `supabase/patrol.sql` (`patrol_points` raw tracks, deleted after 90 days; `coverage_cells` last visit per block).
  Tell crews what's recorded and when before turning it on.

## Live client map (graffiti)

Graffiti → Invoice → **Live client map links** (owner only). Create a private link for Bozeman or Helena and send it to
the client. It opens a read-only map at `/share/map/<link>` with no sign-in: finished tags only, pins colored by month,
a button per calendar season (newest season shown first, "Show all" for everything). It refreshes itself every minute,
so new tags appear on their own. Clients see the spot, address, date and tag type; never crew names, notes, photos,
times or prices. Anyone with the link can view it, so share it only with the client; **Turn off** kills a link at once.
Links are stored in `graffiti_settings` as `share:<token>` (no extra table). The map uses free OpenStreetMap tiles.

## Google My Maps export (graffiti)

Graffiti → Invoice → **Google My Maps export**. Pick Bozeman or Helena and a layer (a calendar season:
Spring Mar-May, Summer Jun-Aug, Fall Sep-Nov, Winter Dec-Feb, or a whole year), then **Download for My Maps (.csv)**.
In My Maps: Add layer → Import the file → Latitude/Longitude as the location, Name as the title → Uniform style →
Group places by: **Month** (one color per month). To refresh the current season later, use the layer's menu →
Reimport and merge → Replace all items with the new file; the shared link doesn't change. Limits: 10 layers per map,
2,000 pins per layer. Bozeman uses one layer per season; Helena is its own map with one layer per year.
My Maps has no API, so this is a manual import.

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
  (urgent ones are called out). The **Reported** filter lists open reports,
  urgent first. There are no push, text or email alerts, only what shows in the app.
- Someone else can take over a claimed job; only the person who took it (or the
  owner) can give it back.
- Existing installs: re-run `supabase/graffiti.sql`. It adds the new columns and is safe to re-run.

**More photos on a tag**

- A tag still has its three timer photos (as reported / before / after). On top of those, any
  graffiti crew account can add **more photos to any tag at any time**: open the tag → *More photos* →
  **Take photo** (camera) or **Choose photos** (pick several from the phone). It works in every
  status, including a finished tag and one on a sent invoice, because extra photos never change the
  time, the status or the bill.
- When *reporting*, you can attach several photos at once (the first is the "as reported" photo, the
  rest are saved as extra photos right after the report; up to 10 at report time).
- Photos upload one at a time, each shrunk like the others. If the signal drops part-way, what was
  already added is kept and the message says how many to choose again. Up to 30 extra photos per tag.
- Each photo shows who added it and when. Whoever added a photo (or the owner) can remove it.
  Deleting a tag removes all its photos. The list card shows "+N photos".
- Extra photos are **not** printed on the invoice's photo page (only the before/after photos are).
- **Logging a tag that is already finished** (Log new → *Already finished? Log it without the timer*):
  you can attach its **before** and **after** photos, chosen from the phone's photos or taken on the
  spot. They are only attached to the tag; the time on site is still the minutes you type (a picked
  photo's time can't be trusted, so it never sets the time). The normal *Take before photo* button
  still uses the camera only, because it starts the timer at the moment the photo is taken.
- Setup: re-run `supabase/graffiti.sql` (adds the `graffiti_photos` table). Until it is run the tag
  list still works; only the extra photos are missing and adding one reports an error.

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
- Invoices are per city. A tag is **Bozeman** or **Helena** by where its pin is
  (the closer city centre); on the invoice page the owner or a crew account with the
  invoice switch can move any one tag to the other city (or back to automatic).
- Each city is billed to its own department: *Billing settings* has a Bill to address and PO number for Bozeman and one for Helena (rate, minimum and terms are shared). They go on the printed invoice and the Google Sheets file.
- Each tag still to invoice has a tick box (all ticked to start). Downloads, totals
  and "Mark … as invoiced" use only the ticked tags; unticked tags stay uninvoiced
  and are offered again next time. A city can have several invoices in a month
  (INV-202610-HEL, INV-202610-HEL-2, …); a tag can be on only one.
- "Mark as invoiced" freezes that invoice's rate, minimum and tag list. Later
  setting changes never alter it. If a tag on it is edited afterwards the page flags
  it as changed, and earlier months with tags still to invoice are flagged.
- Only the owner can change settings or undo an invoice. A tag on a sent invoice
  cannot be deleted or moved to the other city.

**Notes**

- Photos are shrunk in the browser (max 1600px JPEG, GPS/EXIF removed) because
  Vercel limits request bodies to about 4.5 MB. They are served only through
  `/api/graffiti/photo/...` after a sign-in + tab-permission check. Anyone with
  the graffiti tab can view every photo.
- There is no offline queue. If a save fails the photo and its start time stay
  on screen so the crew can retry when they have signal.
- Maps use Leaflet from unpkg and OpenStreetMap tiles; intersection lookup uses
  the free Overpass and Nominatim services (no API keys).
