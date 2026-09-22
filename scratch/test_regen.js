const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai').default;
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// We need to load openai the same way it's done in lib/openai
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY
});

async function main() {
  const sceneId = 'a9687289-e32f-4304-b9f8-b031c45a8f50';
  
  const { data: scene } = await supabase.from('video_scenes').select('*').eq('id', sceneId).single();
  const { data: project } = await supabase.from('video_projects').select('channel_id').eq('id', scene.project_id).single();
  const { data: channel } = await supabase.from('channels').select('image_model').eq('id', project.channel_id).single();
  
  let rawModel = channel?.image_model || "gpt-image-2 low";
  const [modelName, qualityParam] = rawModel.split(" ");
  const imageQuality = (qualityParam === "low" || qualityParam === "standard" || qualityParam === "hd") ? qualityParam : undefined;

  console.log('Model:', modelName, 'Quality:', imageQuality);
  
  const client = modelName.includes('/') ? openrouter : openai;
  
  try {
    const imgResponse = await client.images.generate({
      model: modelName,
      prompt: scene.image_prompt,
      n: 1,
      size: "1024x1024",
      ...(imageQuality ? { quality: imageQuality } : {})
    });
    console.log('Response:', JSON.stringify(imgResponse.data, null, 2));
  } catch (e) {
    console.error('Error:', e.message || e);
  }
}

main();
