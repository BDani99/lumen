import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY || 'placeholder_for_build';
const openRouterApiKey = process.env.OPENROUTER_API_KEY || 'placeholder_for_build';

export const openai = new OpenAI({
  apiKey,
});

export const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: openRouterApiKey,
  defaultHeaders: {
    "HTTP-Referer": "https://lumen.vercel.app",
    "X-Title": "Lumen Studio",
  }
});
