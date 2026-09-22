import { redirect } from "next/navigation";

/** Legacy URL → unified project editor path */
export default async function LegacyEditorRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/projects/${id}/editor`);
}
