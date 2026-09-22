import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";
import ChannelForm from "./ChannelForm";

export const revalidate = 0;

export default async function ChannelEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  if (id === "new") redirect("/channels/new");

  const supabase = await createClient();
  const { data } = await supabase
    .from("channels")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) notFound();

  return (
    <main className="mx-auto max-w-4xl px-4 md:px-8 py-8 md:py-10 animate-lumen-in">
      <ChannelForm initialChannel={data} userId={user.id} />
    </main>
  );
}
