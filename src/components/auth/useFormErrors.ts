"use client";

import { useState } from "react";
import type { AuthFieldName, AuthFormState } from "@/app/auth/form-state";

type FieldErrors = Partial<Record<AuthFieldName, string>>;

/**
 * Field-error bookkeeping shared by the auth forms. Shows client-side errors
 * (instant feedback before submit) and server-returned errors (`state.fieldErrors`),
 * and hides a field's error as soon as the user edits that field again.
 */
export function useFormErrors(state: AuthFormState) {
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [edited, setEdited] = useState<Partial<Record<AuthFieldName, boolean>>>({});

  // A new server response starts a fresh round: forget stale client-side state.
  // (Adjusting state during render is React's supported alternative to an effect here.)
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    setClientErrors({});
    setEdited({});
  }

  const errorFor = (field: AuthFieldName): string | undefined =>
    edited[field] ? undefined : clientErrors[field] ?? state.fieldErrors?.[field];

  const markEdited = (field: AuthFieldName) =>
    setEdited((prev) => (prev[field] ? prev : { ...prev, [field]: true }));

  const setClient = (errors: FieldErrors) => {
    setClientErrors(errors);
    setEdited({});
  };

  return { errorFor, markEdited, setClient };
}
