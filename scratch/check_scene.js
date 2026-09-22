const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const sceneId = 'a9687289-e32f-4304-b9f8-b031c45a8f50';
  console.log('Fetching scene', sceneId);
  const { data, error } = await supabase.from('video_scenes').select('*').eq('id', sceneId).single();
  if (error) {
    console.error('Error:', error);
    return;
  }
  console.log('Scene:', data);
}

main();
