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
  // True once a realtime channel has been failing for a few seconds (the UI keeps
  // working from local state; this only drives a non-blocking warning).
  const [realtimeError, setRealtimeError] = useState(false);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    // Supabase retries a broken channel on its own, so a blip must not flash a
    // warning: only report after the failure has lasted a few seconds.
    const failing = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const trackStatus = (name: string) => (status: string) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        failing.add(name);
        if (!timer) timer = setTimeout(() => setRealtimeError(true), 4000);
      } else if (status === "SUBSCRIBED") {
        failing.delete(name);
        if (failing.size === 0) {
          if (timer) clearTimeout(timer);
          timer = undefined;
          setRealtimeError(false);
        }
      }
    };

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
      .subscribe(trackStatus("scenes"));

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
      .subscribe(trackStatus("project"));

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(sceneSubscription);
      supabase.removeChannel(projectSubscription);
    };
  }, [project.id, router, supabase]);

  return { project, setProject, scenes, setScenes, realtimeError };
}
