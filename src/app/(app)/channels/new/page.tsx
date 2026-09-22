import { requireUser } from "@/lib/auth";
import ChannelForm from "../[id]/ChannelForm";

export const revalidate = 0;

export default async function NewChannelPage() {
  const user = await requireUser();
  return (
    <main className="mx-auto max-w-4xl px-4 md:px-8 py-8 md:py-10 animate-lumen-in">
      <ChannelForm initialChannel={null} userId={user.id} />
    </main>
  );
}
