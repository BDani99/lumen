"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/hooks/useConfirm";
import { apiFetch, getErrorMessage, isAbortError } from "@/lib/api-client";

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
      await apiFetch(`/api/projects/${project.id}/script`, {
        method: "PATCH",
        json: { script: scriptDraft },
      });
      setProject((prev: any) => ({ ...prev, generated_script: scriptDraft.trim() }));
    } catch (e: unknown) {
      if (isAbortError(e)) return;
      setEditorError(getErrorMessage(e, "A forgatókönyv mentése nem sikerült. Próbáld újra."));
    } finally {
      setScriptBusy(false);
    }
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
      await apiFetch(`/api/projects/${project.id}/continue`, {
        method: "POST",
        json: { script: scriptDraft },
      });
      router.push(`/projects/${project.id}/progress`);
    } catch (e: unknown) {
      if (isAbortError(e)) return;
      setEditorError(getErrorMessage(e, "A folytatás nem sikerült. Próbáld újra."));
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
      await apiFetch(`/api/projects/${project.id}/script/regenerate`, { method: "POST" });
      router.push(`/projects/${project.id}/progress`);
    } catch (e: unknown) {
      if (isAbortError(e)) return;
      setEditorError(getErrorMessage(e, "A forgatókönyv újragenerálása nem sikerült. Próbáld újra."));
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
