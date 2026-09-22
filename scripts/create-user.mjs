/**
 * One-off admin helper: create a Supabase auth user directly (bypasses the
 * /register flow + email confirmation), e.g. for seeding a first account on
 * a fresh project.
 *
 * Usage:
 *   npx dotenv -e .env.local -- node scripts/create-user.mjs <email> <password>
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/create-user.mjs <email> <password>');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (error) {
    console.error('Hiba:', error.message);
    process.exit(1);
  }
  console.log('Siker! User ID:', data.user.id);
}

main();
