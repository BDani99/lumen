/**
 * One-off backfill for the dictionary_owners table (see migration
 * 20260922000000_add_dictionary_owners.sql). AI33 pronunciation dictionaries
 * created before per-user ownership existed have no owner row yet — this
 * assigns every existing AI33 dictionary to one Lumen user (the solo
 * developer's own account, for a single-user install being opened up).
 *
 * The target user id is a required CLI argument, never hardcoded, so this
 * script is safe to keep committed.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-dictionary-owners.ts <user-uuid>            (dry run)
 *   npx tsx --env-file=.env.local scripts/backfill-dictionary-owners.ts <user-uuid> --confirm   (writes)
 */
import { createClient } from "@supabase/supabase-js";
import { AI33Client } from "../src/lib/ai33";

const USER_ID = process.argv[2];
const CONFIRM = process.argv.includes("--confirm");

if (!USER_ID || USER_ID.startsWith("--")) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/backfill-dictionary-owners.ts <user-uuid> [--confirm]");
  process.exit(1);
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function main() {
  const ai33 = new AI33Client();
  const dictionaries = await ai33.listDictionaries();
  console.log(`Found ${dictionaries.length} AI33 dictionary/dictionaries.`);

  const { data: existing } = await sb.from("dictionary_owners").select("dictionary_id");
  const alreadyOwned = new Set((existing || []).map((r) => r.dictionary_id));

  const toAssign = dictionaries.filter((d) => !alreadyOwned.has(d.id));
  console.log(`${toAssign.length} dictionary/dictionaries need an owner row assigned to user ${USER_ID}:`);
  for (const d of toAssign) {
    console.log(`  [${d.id}] ${d.name}`);
  }

  if (toAssign.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (!CONFIRM) {
    console.log("\nDry run only — pass --confirm to write the owner rows.");
    return;
  }

  const { error } = await sb
    .from("dictionary_owners")
    .insert(toAssign.map((d) => ({ dictionary_id: d.id, user_id: USER_ID })));
  if (error) throw new Error(error.message);

  console.log(`\nAssigned ${toAssign.length} dictionary/dictionaries to user ${USER_ID}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
