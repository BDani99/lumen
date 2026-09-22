import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/utils/supabase/server";
import { Button, EmptyState } from "@/components/ui";

export const revalidate = 0;

export default async function ChannelsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: channels } = await supabase
    .from("channels")
    .select("id, name, language, ai33_voice_settings, text_model, image_model")
    .eq("user_id", user.id)
    .order("name");

  const list = channels || [];

  return (
    <main className="mx-auto max-w-4xl px-4 md:px-8 py-8 md:py-10 animate-lumen-in">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl md:text-4xl tracking-tight text-ink">Csatornák</h1>
          <p className="mt-1.5 text-sm text-muted">Hang, stílus és modell beállítások</p>
        </div>
        <Link href="/channels/new">
          <Button>+ Új csatorna</Button>
        </Link>
      </div>

      {list.length === 0 ? (
        <EmptyState
          title="Nincs még csatorna"
          description="A csatorna határozza meg a hangot, a képstílust és a forgatókönyv szabályait."
          action={
            <Link href="/channels/new">
              <Button>Csatorna létrehozása</Button>
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {list.map((channel) => {
            const voice =
              channel.ai33_voice_settings?.voiceName ||
              channel.ai33_voice_settings?.voiceId ||
              "—";
            return (
              <li
                key={channel.id}
                className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <h2 className="font-display text-lg text-ink tracking-tight truncate">
                    {channel.name}
                  </h2>
                  <p className="mt-1 text-sm text-muted truncate">
                    {channel.language || "—"}
                    {" · "}
                    {voice}
                  </p>
                </div>
                <Link href={`/channels/${channel.id}`}>
                  <Button variant="secondary">Szerkesztés</Button>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
