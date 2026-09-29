import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { currentUser, SuggestionRow, toView, UUID_RE } from "@/lib/suggestions";
import { newId, normalizeProjects, Project, projectId, todayISO } from "@/lib/projects";

// PATCH  /api/suggestions/:id  { action: "vote" | "accept" | "decline" | "reopen" }
//   vote     -> any signed-in user toggles their upvote
//   accept   -> reviewers only: turns the idea into a real project
//   decline / reopen -> reviewers only
// DELETE /api/suggestions/:id  -> reviewers, or the submitter while it's still pending
//
// "Reviewers" = the owner, or anyone granted edit access to the Projects tab.

export const dynamic = "force-dynamic";

async function loadRow(id: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("project_suggestions").select("*").eq("id", id).maybeSingle();
  return { supabase, row: (data ?? null) as SuggestionRow | null, error };
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let action = "";
  try {
    const body = (await request.json()) as { action?: unknown };
    action = typeof body.action === "string" ? body.action : "";
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { supabase, row, error } = await loadRow(params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "That suggestion no longer exists." }, { status: 404 });

  if (action === "vote") {
    const votes = row.votes ?? [];
    const next = votes.includes(userId) ? votes.filter((v) => v !== userId) : [...votes, userId];
    const { data, error: upErr } = await supabase
      .from("project_suggestions")
      .update({ votes: next })
      .eq("id", row.id)
      .select("*")
      .single();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    return NextResponse.json({ suggestion: toView(data as SuggestionRow, userId) });
  }

  if (!["accept", "decline", "reopen"].includes(action)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const me = await currentUser(userId);
  if (!me.canReview) return NextResponse.json({ error: "Only project editors can review suggestions." }, { status: 403 });

  const reviewed = { reviewed_at: new Date().toISOString(), reviewed_by: userId };

  if (action === "accept") {
    if (row.status !== "pending") {
      return NextResponse.json({ error: "Only pending suggestions can be accepted." }, { status: 409 });
    }
    const { data: tab, error: tabErr } = await supabase.from("tab_content").select("content").eq("tab", "projects").maybeSingle();
    if (tabErr) return NextResponse.json({ error: tabErr.message }, { status: 500 });

    const projects = normalizeProjects(tab?.content ?? []);
    const project: Project = {
      id: projectId(row.title),
      name: row.title,
      status: "idea",
      summary: row.details.split("\n")[0].slice(0, 200),
      description: row.details,
      progress: 0,
      links: [],
      updates: [{ id: newId(), date: todayISO(), text: `Accepted from a suggestion by ${row.submitter_name || "someone"}.` }],
      createdAt: new Date().toISOString(),
      suggestedBy: row.submitter_name || undefined,
    };
    const nextProjects = [project, ...projects];

    const { error: saveErr } = await supabase
      .from("tab_content")
      .update({ content: nextProjects, updated_at: new Date().toISOString(), updated_by: userId })
      .eq("tab", "projects");
    if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 });

    const { data, error: upErr } = await supabase
      .from("project_suggestions")
      .update({ status: "accepted", project_id: project.id, ...reviewed })
      .eq("id", row.id)
      .select("*")
      .single();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    return NextResponse.json({ suggestion: toView(data as SuggestionRow, userId), projects: nextProjects, projectId: project.id });
  }

  // decline / reopen. Reopening does not remove a project that was already
  // created from it; that project stays until you delete it yourself.
  const patch =
    action === "decline" ? { status: "declined", ...reviewed } : { status: "pending", project_id: null, reviewed_at: null, reviewed_by: null };
  const { data, error: upErr } = await supabase.from("project_suggestions").update(patch).eq("id", row.id).select("*").single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ suggestion: toView(data as SuggestionRow, userId) });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const { userId } = auth();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { supabase, row, error } = await loadRow(params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ ok: true });

  const ownPending = row.submitter_id === userId && row.status === "pending";
  if (!ownPending) {
    const me = await currentUser(userId);
    if (!me.canReview) return NextResponse.json({ error: "You can only delete your own pending ideas." }, { status: 403 });
  }

  const { error: delErr } = await supabase.from("project_suggestions").delete().eq("id", row.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
