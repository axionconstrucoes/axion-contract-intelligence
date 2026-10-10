import { redirect } from "next/navigation";

export default async function DashboardVisualRedirectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/${projectId}/dashboard`);
}
