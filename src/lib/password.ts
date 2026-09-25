/**
 * Password policy + strength scoring. Pure and dependency-free so the SAME
 * code drives the live strength meter in the browser and the enforcement in
 * the server actions — the client check is only a convenience, the server
 * check is the real gate.
 */

export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt (used by Supabase Auth) silently ignores everything past 72 bytes. */
export const MAX_PASSWORD_LENGTH = 72;

export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export type PasswordCheck = {
  id: "length" | "letter" | "number";
  /** Short label for the live checklist. */
  label: string;
  /** Full sentence used when the server refuses the password. */
  error: string;
  passed: boolean;
};

export type PasswordEvaluation = {
  score: PasswordScore;
  label: string;
  /** Required rules — the ones that make `valid` true/false. */
  checks: PasswordCheck[];
  /** Extra reasons a password is refused (too common, contains the email, …). */
  problems: string[];
  /** Optional ways to make it stronger. */
  tips: string[];
  valid: boolean;
};

const SCORE_LABELS: Record<PasswordScore, string> = {
  0: "Túl rövid",
  1: "Gyenge",
  2: "Közepes",
  3: "Erős",
  4: "Nagyon erős",
};

// Lowercase. Mix of the classics and the ones Hungarian users actually pick.
const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000",
  "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "p@ssword",
  "qwerty123", "qwertyui", "qwertyuiop", "qwertz123", "qwertzui", "qwertzuiop",
  "asdfghjk", "asdfghjkl", "asdf1234", "zxcvbnm1", "yxcvbnm1", "1q2w3e4r", "1qaz2wsx",
  "abc12345", "abcd1234", "abcdefgh", "iloveyou", "letmein1", "welcome1", "admin123",
  "administrator", "changeme", "trustno1", "monkey12", "dragon12", "football", "baseball",
  "jelszo", "jelszo1", "jelszo12", "jelszo123", "jelszo1234", "jelszo2024", "jelszo2025",
  "titkos12", "titkos123", "szeretlek", "szia1234", "sziasztok", "budapest", "budapest1",
  "magyarorszag", "magyar123", "kiskutya", "macska123", "focista1", "lumen123",
]);

const KEYBOARD_ROWS = [
  "1234567890",
  "qwertyuiop",
  "qwertzuiop",
  "asdfghjkl",
  "zxcvbnm",
  "yxcvbnm",
];

function hasLetter(pw: string) {
  return /\p{L}/u.test(pw);
}
function hasDigit(pw: string) {
  return /\d/.test(pw);
}
function hasLower(pw: string) {
  return /\p{Ll}/u.test(pw);
}
function hasUpper(pw: string) {
  return /\p{Lu}/u.test(pw);
}
function hasSymbol(pw: string) {
  return /[^\p{L}\d\s]/u.test(pw);
}

/** Three identical chars in a row, or a 4-char run like "abcd" / "4321" / "qwer". */
function hasPattern(pw: string): boolean {
  const lower = pw.toLowerCase();
  if (/(.)\1{2,}/u.test(lower)) return true;
  for (let i = 0; i + 4 <= lower.length; i++) {
    const w = lower.slice(i, i + 4);
    if (KEYBOARD_ROWS.some((row) => row.includes(w) || [...row].reverse().join("").includes(w))) {
      return true;
    }
    const codes = [...w].map((c) => c.charCodeAt(0));
    const asc = codes.every((c, j) => j === 0 || c === codes[j - 1] + 1);
    const desc = codes.every((c, j) => j === 0 || c === codes[j - 1] - 1);
    if (asc || desc) return true;
  }
  return false;
}

function isCommon(pw: string): boolean {
  const lower = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return true;
  // "jelszo" + decoration: strip trailing digits/symbols and look again.
  const stripped = lower.replace(/[\d\W_]+$/u, "");
  return stripped.length >= 5 && COMMON_PASSWORDS.has(stripped);
}

function containsEmailPart(pw: string, email?: string): boolean {
  if (!email) return false;
  const lower = pw.toLowerCase();
  const address = email.trim().toLowerCase();
  if (!address) return false;
  if (lower === address) return true;
  const local = address.split("@")[0] ?? "";
  return local.length >= 4 && lower.includes(local);
}

export function evaluatePassword(password: string, ctx: { email?: string } = {}): PasswordEvaluation {
  const length = [...password].length;

  const checks: PasswordCheck[] = [
    {
      id: "length",
      label: `Legalább ${MIN_PASSWORD_LENGTH} karakter`,
      error: `A jelszónak legalább ${MIN_PASSWORD_LENGTH} karakter hosszúnak kell lennie.`,
      passed: length >= MIN_PASSWORD_LENGTH,
    },
    {
      id: "letter",
      label: "Tartalmaz betűt",
      error: "A jelszónak tartalmaznia kell legalább egy betűt.",
      passed: hasLetter(password),
    },
    {
      id: "number",
      label: "Tartalmaz számot",
      error: "A jelszónak tartalmaznia kell legalább egy számot.",
      passed: hasDigit(password),
    },
  ];

  const problems: string[] = [];
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_LENGTH) {
    problems.push(`A jelszó legfeljebb ${MAX_PASSWORD_LENGTH} bájt (kb. karakter) hosszú lehet.`);
  }
  if (length >= MIN_PASSWORD_LENGTH && isCommon(password)) {
    problems.push("Ez egy túl gyakori jelszó — válassz egyedibbet.");
  }
  if (length >= 1 && containsEmailPart(password, ctx.email)) {
    problems.push("A jelszó nem tartalmazhatja az email címedet.");
  }

  const requiredMet = checks.every((c) => c.passed);
  const valid = requiredMet && problems.length === 0;

  // Points only rank passwords that are already acceptable.
  let points = 0;
  if (length >= 8) points += 1;
  if (length >= 12) points += 1;
  if (length >= 16) points += 1;
  const classes = [hasLower(password), hasUpper(password), hasDigit(password), hasSymbol(password)].filter(Boolean).length;
  points += Math.max(0, classes - 1);
  if (hasPattern(password)) points -= 1;

  let score: PasswordScore;
  if (length === 0 || length < MIN_PASSWORD_LENGTH) score = 0;
  else if (!valid) score = 1;
  else if (points <= 3) score = 2;
  else if (points === 4) score = 3;
  else score = 4;

  const tips: string[] = [];
  if (valid && score < 4) {
    if (length < 12) tips.push("12 vagy több karakter");
    if (!(hasLower(password) && hasUpper(password))) tips.push("kis- és nagybetű vegyesen");
    if (!hasSymbol(password)) tips.push("speciális karakter (pl. ! ? - _)");
    if (hasPattern(password)) tips.push("kerüld az ismétlődő vagy sorban következő karaktereket");
  }

  return { score, label: SCORE_LABELS[score], checks, problems, tips, valid };
}

/**
 * Server-side gate: returns the Hungarian reasons a password is refused
 * (empty array = acceptable).
 */
export function validatePassword(password: string, ctx: { email?: string } = {}): string[] {
  const evaluation = evaluatePassword(password, ctx);
  return [
    ...evaluation.checks.filter((c) => !c.passed).map((c) => c.error),
    ...evaluation.problems,
  ];
}
