"use client";

import type { ReactNode } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Megerősítés",
  cancelLabel = "Mégse",
  tone = "default",
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {description && <div className="text-sm text-muted">{description}</div>}
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
          {busy ? "…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
