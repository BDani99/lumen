import { requireUser } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";
import NewVideoButton from "./NewVideoButton";
import ProjectTable from "./ProjectTable";
import { EmptyState } from "@/components/ui";
import Link from "next/link";
import { Button } from "@/components/ui";

export const revalidate = 0;

export default async function Dashboard() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("video_projects")
    .select(
      "id, title, status, created_at, updated_at, is_flagged, thumbnail_url, generated_script, generation_cost_usd, timeline_data, pipeline, channels(name)"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: channels } = await supabase
    .from("channels")
    .select(
      "id, name, video_generation_defaults, image_model, sentences_per_image, ai33_voice_settings, text_model, polish_model"
    )
    .eq("user_id", user.id);

  const list = projects || [];
  const channelList = channels || [];

  return (
    <main className="mx-auto max-w-6xl px-4 md:px-8 py-8 md:py-10 animate-lumen-in">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight text-ink">Projektek</h1>
          <p className="mt-1.5 text-sm text-muted">Generált és folyamatban lévő videóid</p>
        </div>
        <NewVideoButton channels={channelList} />
      </div>

      {list.length === 0 ? (
        <EmptyState
          title="Még nincs projekt"
          description={
            channelList.length === 0
              ? "Először hozz létre egy csatornát hang- és stílusbeállításokkal, majd indíts egy új videót."
              : "Indíts egy új videót a kiválasztott csatornáddal."
          }
          action={
            channelList.length === 0 ? (
              <Link href="/channels/new">
                <Button>Új csatorna</Button>
              </Link>
            ) : (
              <NewVideoButton channels={channelList} />
            )
          }
        />
      ) : (
        <ProjectTable initialProjects={list} />
      )}
    </main>
  );
}
