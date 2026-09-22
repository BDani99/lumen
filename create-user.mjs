import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data, error } = await supabase.auth.admin.createUser({
    email: 'test@test.com',
    password: 'password123',
    email_confirm: true
  });
  
  if (error) {
    console.error('Hiba:', error.message);
    process.exit(1);
  }
  console.log('Siker! User ID:', data.user.id);
}

main();
