const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({path: '.env.local'});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function testUpload() {
  try {
    const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/a/a7/React-icon.svg';
    console.log('Fetching image...');
    const imgRes = await fetch(imageUrl);
    const arrayBuffer = await imgRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = `test/test_${Date.now()}.svg`;
    
    console.log('Uploading to supabase...');
    const { data, error } = await supabaseAdmin.storage.from('video_images').upload(fileName, buffer, { contentType: 'image/svg+xml' });
    if (error) throw error;
    console.log('Upload success!', data);
  } catch (e) {
    console.error('Upload failed:', e);
  }
}

testUpload();
