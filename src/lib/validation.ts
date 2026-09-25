/** Pragmatic email check: something@domain.tld, no spaces. The real gate is Supabase's own validation. */
export function isValidEmail(email: string): boolean {
  if (email.length === 0 || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** Field-level email message (undefined = fine). Shared by the browser forms and the server actions. */
export function emailFieldError(email: string): string | undefined {
  if (!email) return "Add meg az email címed.";
  if (!isValidEmail(email)) return "Ez nem tűnik érvényes email címnek.";
  return undefined;
}
