"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

/**
 * Owns `project` / `scenes` client state and keeps them in sync with Supabase
 * realtime — scene inserts/updates from `video_scenes`, and project field
 * updates from `video_projects`. Both channels are scoped to `project.id`.
 */
export function useProjectRealtime(initialProject: any) {
  const [project, setProject] = useState(initialProject);
  const [scenes, setScenes] = useState<any[]>(initialProject.video_scenes || []);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const sceneSubscription = supabase
      .channel("schema-db-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "video_scenes",
          filter: `project_id=eq.${project.id}`,
        },
        (payload) => {
          router.refresh();
          if (payload.eventType === "INSERT") {
            setScenes((prev) =>
              [...prev, payload.new].sort((a, b) => a.scene_order - b.scene_order)
            );
          } else if (payload.eventType === "UPDATE") {
            setScenes((prev) => prev.map((s) => (s.id === payload.new.id ? payload.new : s)));
          }
        }
      )
      .subscribe();

    const projectSubscription = supabase
      .channel("project-changes")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_projects",
          filter: `id=eq.${project.id}`,
        },
        (payload) => {
          setProject((prev: any) => ({ ...prev, ...payload.new }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sceneSubscription);
      supabase.removeChannel(projectSubscription);
    };
  }, [project.id, router, supabase]);

  return { project, setProject, scenes, setScenes };
}
