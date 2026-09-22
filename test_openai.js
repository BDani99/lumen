const OpenAI = require('openai');
require('dotenv').config({path: '.env.local'});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function run() {
  try {
    console.log('Generating image...');
    const response = await openai.images.generate({
      model: 'gpt-image-2',
      prompt: 'A cute cat',
      n: 1,
      size: '1024x1024',
    });
    require('fs').writeFileSync('response.json', JSON.stringify(response, null, 2));
  } catch (e) {
    console.error(e.message);
  }
}
run();
