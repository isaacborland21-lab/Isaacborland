// Suggested projects: shared types + helpers for the /api/suggestions routes.
// Server-only (imports the service-role Supabase client).

import { clerkClient } from "@clerk/nextjs/server";
import { canEditTab, PublicMetadata } from "@/lib/supabaseAdmin";

export type SuggestionStatus = "pending" | "accepted" | "declined";

export type SuggestionRow = {
  id: string;
  title: string;
  details: string;
  submitter_id: string;
  submitter_name: string;
  status: SuggestionStatus;
  votes: string[] | null;
  project_id: string | null;
  created_at: string;
  reviewed_at: string | null;
};

// What the browser sees. Other users' ids never leave the server:
// votes become a count plus "did I vote", and ownership becomes a flag.
export type SuggestionView = {
  id: string;
  title: string;
  details: string;
  submitterName: string;
  status: SuggestionStatus;
  votes: number;
  voted: boolean;
  mine: boolean;
  projectId: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export function toView(row: SuggestionRow, userId: string): SuggestionView {
  const votes = row.votes ?? [];
  return {
    id: row.id,
    title: row.title,
    details: row.details,
    submitterName: row.submitter_name || "Someone",
    status: row.status,
    votes: votes.length,
    voted: votes.includes(userId),
    mine: row.submitter_id === userId,
    projectId: row.project_id,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Looks up the signed-in user once: display name + whether they can review.
export async function currentUser(userId: string) {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const metadata = user.publicMetadata as PublicMetadata;
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  const email = user.emailAddresses?.[0]?.emailAddress ?? "";
  return {
    name: full || (email ? email.split("@")[0] : "Someone"),
    canReview: canEditTab(metadata, "projects"),
  };
}
