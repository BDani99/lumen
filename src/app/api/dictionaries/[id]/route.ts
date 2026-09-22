import { NextResponse } from "next/server";
import { AI33Client, ai33UserMessage } from "@/lib/ai33";
import { requireUserApi } from "@/lib/auth";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) {
      return NextResponse.json({ error: "AI33_API_KEY is not configured" }, { status: 500 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const input: { name?: string; rules?: unknown } = {};
    if (typeof body.name === "string" && body.name.trim()) input.name = body.name.trim();
    if (Array.isArray(body.rules)) input.rules = body.rules;

    const ai33 = new AI33Client();
    const dictionary = await ai33.updateDictionary(id, input as any);
    return NextResponse.json({ dictionary });
  } catch (error: any) {
    console.error("[api/dictionaries/[id] PUT]", error);
    return NextResponse.json({ error: ai33UserMessage(error) }, { status: 502 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireUserApi();
    if (auth.error) return auth.error;

    if (!process.env.AI33_API_KEY) {
      return NextResponse.json({ error: "AI33_API_KEY is not configured" }, { status: 500 });
    }

    const { id } = await params;
    const ai33 = new AI33Client();
    await ai33.deleteDictionary(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[api/dictionaries/[id] DELETE]", error);
    return NextResponse.json({ error: ai33UserMessage(error) }, { status: 502 });
  }
}
