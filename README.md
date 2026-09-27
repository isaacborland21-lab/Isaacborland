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
