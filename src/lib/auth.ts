import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Throws redirect via never — use in Server Components / actions. */
export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
  }
  return user!;
}

/** For API routes — returns NextResponse on failure, or the user. */
export async function requireUserApi(): Promise<
  { user: User; error?: undefined } | { user?: undefined; error: NextResponse }
> {
  const user = await getUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { user };
}

export async function assertChannelOwned(
  channelId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("channels")
    .select("id")
    .eq("id", channelId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

export async function assertProjectOwned(
  projectId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("video_projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

export async function assertNamePoolPresetOwned(
  presetId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("name_pool_presets")
    .select("id")
    .eq("id", presetId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}
