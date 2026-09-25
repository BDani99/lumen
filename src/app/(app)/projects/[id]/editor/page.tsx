import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";
import EditorApp from "./EditorApp";
import { ErrorState } from "@/components/ui";
import { dbErrorMessage } from "@/lib/errors";

export const revalidate = 0;

export default async function EditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const supabase = await createClient();

  const { data: project, error } = await supabase
    .from("video_projects")
    .select("*, video_scenes(*), channels(image_model, video_generation_defaults, location_shot_sec)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[editor]", error);
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

  if (project.video_scenes) {
    project.video_scenes.sort((a: any, b: any) => a.scene_order - b.scene_order);
  }

  const channel = Array.isArray(project.channels)
    ? project.channels[0]
    : (project as any).channels;

  return <EditorApp initialProject={project} channel={channel || null} />;
}
