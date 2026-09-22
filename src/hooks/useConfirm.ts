"use client";

import { useCallback, useState } from "react";
import type { ReactNode } from "react";

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

/**
 * Imperative confirm() replacement backed by the app's own ConfirmDialog
 * instead of the native browser dialog. Usage:
 *
 *   const { confirm, dialogProps } = useConfirm();
 *   ...
 *   if (!(await confirm({ title: "Biztosan törlöd?", tone: "danger" }))) return;
 *   ...
 *   return <ConfirmDialog {...dialogProps} />;
 */
export function useConfirm() {
  const [pending, setPending] = useState<{
    resolve: (value: boolean) => void;
    opts: ConfirmOptions;
  } | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ resolve, opts });
    });
  }, []);

  const close = useCallback((result: boolean) => {
    setPending((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  return {
    confirm,
    dialogProps: {
      open: pending !== null,
      title: pending?.opts.title ?? "",
      description: pending?.opts.description,
      confirmLabel: pending?.opts.confirmLabel,
      cancelLabel: pending?.opts.cancelLabel,
      tone: pending?.opts.tone,
      onClose: () => close(false),
      onConfirm: () => close(true),
    },
  };
}
