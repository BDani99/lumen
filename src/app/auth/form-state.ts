export type AuthFieldName = "email" | "password" | "confirm";

/**
 * What every auth server action returns to its form. Expected problems
 * (validation, wrong password, service down) are RETURNED, not thrown or
 * smuggled through a `?message=` redirect — the form stays on screen with
 * the user's input and shows the message next to the field / above the button.
 */
export type AuthFormState = {
  status: "idle" | "error" | "success";
  /** Form-level message (Banner). */
  message?: string;
  /** Per-field messages. */
  fieldErrors?: Partial<Record<AuthFieldName, string>>;
  /** Echoed back so the email field survives the round-trip. */
  email?: string;
};

export const initialAuthState: AuthFormState = { status: "idle" };
