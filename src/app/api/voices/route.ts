import { NextResponse } from "next/server";
import { AI33Client, ai33UserMessage, type AI33VoiceProvider } from "@/lib/ai33";
import { requireUserApi } from "@/lib/auth";

const ALLOWED_PROVIDERS = new Set<AI33VoiceProvider>([
  "elevenlabs",
  "minimax",
  "fishaudio",
]);

export async function GET(req: Request) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    const { searchParams } = new URL(req.url);
    const provider = searchParams.get("provider") as AI33VoiceProvider | null;

    if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
      return NextResponse.json(
        { error: "Missing or invalid provider. Use elevenlabs, minimax, or fishaudio." },
        { status: 400 }
      );
    }

    if (!process.env.AI33_API_KEY) {
      return NextResponse.json(
        { error: "AI33_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("page_size") || searchParams.get("limit") || 30)));
    const search = searchParams.get("search") || searchParams.get("q") || undefined;
    const sort = searchParams.get("sort") || undefined;
    const language = searchParams.get("language") || undefined;
    const gender = searchParams.get("gender") || undefined;
    const filters = searchParams.get("filters") || undefined;

    const ai33 = new AI33Client();
    const result = await ai33.listVoices({
      provider,
      search,
      page,
      pageSize,
      sort,
      language,
      gender,
      filters,
    });

    return NextResponse.json({
      voices: result.voices,
      pagination: result.pagination,
    });
  } catch (error: any) {
    console.error("[api/voices]", error);
    return NextResponse.json({ error: ai33UserMessage(error) }, { status: 502 });
  }
}
