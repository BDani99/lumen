"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/hooks/useConfirm";

/** Script-review draft editing: save, continue to generation, or regenerate from scratch. */
export function useScriptEditing({
  project,
  setProject,
  setEditorError,
}: {
  project: any;
  setProject: (updater: (prev: any) => any) => void;
  setEditorError: (message: string | null) => void;
}) {
  const [scriptDraft, setScriptDraft] = useState(project.generated_script || "");
  const [scriptBusy, setScriptBusy] = useState(false);
  const router = useRouter();
  const { confirm, dialogProps: confirmDialogProps } = useConfirm();

  useEffect(() => {
    if (project.generated_script != null) {
      setScriptDraft(project.generated_script || "");
    }
  }, [project.generated_script, project.status]);

  const handleSaveScript = async () => {
    if (!scriptDraft.trim()) {
      setEditorError("A forgatókönyv nem lehet üres.");
      return;
    }
    setScriptBusy(true);
    setEditorError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/script`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: scriptDraft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Mentés sikertelen");
      }
      setProject((prev: any) => ({ ...prev, generated_script: scriptDraft.trim() }));
    } catch (e: any) {
      setEditorError(e.message || "Mentés sikertelen");
    }
    setScriptBusy(false);
  };

  const handleContinueFromScript = async () => {
    if (!scriptDraft.trim()) {
      setEditorError("A forgatókönyv nem lehet üres.");
      return;
    }
    if (!(await confirm({ title: "Folytatod a hang- és képgenerálást ezzel a szöveggel?" }))) return;
    setScriptBusy(true);
    setEditorError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: scriptDraft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Folytatás sikertelen");
      }
      router.push(`/projects/${project.id}/progress`);
    } catch (e: any) {
      setEditorError(e.message || "Folytatás sikertelen");
      setScriptBusy(false);
    }
  };

  const handleRegenerateScript = async () => {
    if (
      !(await confirm({
        title: "Újragenerálod a teljes forgatókönyvet?",
        description: "A jelenlegi szöveg felülíródik.",
      }))
    )
      return;
    setScriptBusy(true);
    setEditorError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/script/regenerate`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Újragenerálás sikertelen");
      }
      router.push(`/projects/${project.id}/progress`);
    } catch (e: any) {
      setEditorError(e.message || "Újragenerálás sikertelen");
      setScriptBusy(false);
    }
  };

  return {
    scriptDraft,
    setScriptDraft,
    scriptBusy,
    handleSaveScript,
    handleContinueFromScript,
    handleRegenerateScript,
    confirmDialogProps,
  };
}
