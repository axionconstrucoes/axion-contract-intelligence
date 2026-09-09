import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@axion/db/server";
import { SsmaFieldApp } from "@/components/ssma/ssma-field-app";
import { getProject, getProjectMembers } from "@/lib/data";
import { buildEsgSsmaProjectFolderName } from "@/lib/integrations/esg-ssma/drive-source-policy";

export const metadata: Metadata = { title: "Aplicativo SSMA/ESG" };

function projectLabel(project: NonNullable<Awaited<ReturnType<typeof getProject>>>): string {
  try {
    return buildEsgSsmaProjectFolderName(project.code, project.client, project.location, project.name);
  } catch {
    return `${project.code} ${project.name}`.trim().toLocaleUpperCase("pt-BR");
  }
}

function currentDateTimeInSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

export default async function SsmaAppPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: authData }, project, members] = await Promise.all([
    supabase.auth.getUser(),
    getProject(projectId),
    getProjectMembers(projectId),
  ]);

  if (!authData.user) redirect("/login");
  if (!project) notFound();

  const currentMember = members.find((member) => member.userId === authData.user.id && member.status === "ACTIVE");
  if (!currentMember) notFound();

  const technicianLabel = currentMember.user.title
    ? `${currentMember.user.name} — ${currentMember.user.title}`
    : currentMember.user.name;

  return (
    <SsmaFieldApp
      projectId={projectId}
      projectLabel={projectLabel(project)}
      technicianLabel={technicianLabel}
      initialDateTime={currentDateTimeInSaoPaulo()}
    />
  );
}
