import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";
import ProgressView from "./ProgressView";
import { ErrorState } from "@/components/ui";
import { dbErrorMessage } from "@/lib/errors";

export const revalidate = 0;

export default async function ProjectProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const supabase = await createClient();

  const { data: project, error } = await supabase
    .from("video_projects")
    .select("id, title, status, created_at, updated_at, generation_cost_usd, channels(name)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[progress]", error);
    return (
      <main className="mx-auto max-w-3xl px-4 md:px-8 py-16">
        <ErrorState
          title="A projekt nem tölthető be"
          description={dbErrorMessage(error, "Nem sikerült betölteni a projektet.")}
        />
      </main>
    );
  }

  if (!project) notFound();

  // Missing logs are not fatal — the view live-updates and the header still works.
  const { data: logs, error: logsError } = await supabase
    .from("generation_logs")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: true });

  if (logsError) console.error("[progress] logs query failed", logsError);

  const channelName = Array.isArray((project as any).channels)
    ? (project as any).channels[0]?.name
    : (project as any).channels?.name;

  return (
    <main className="mx-auto max-w-3xl px-4 md:px-8 py-8 md:py-10 animate-lumen-in">
      <ProgressView
        initialProject={{
          id: project.id,
          title: project.title,
          status: project.status,
          created_at: project.created_at,
          updated_at: project.updated_at,
          generation_cost_usd: project.generation_cost_usd,
          channel_name: channelName || "Ismeretlen",
        }}
        initialLogs={logs || []}
      />
    </main>
  );
}
