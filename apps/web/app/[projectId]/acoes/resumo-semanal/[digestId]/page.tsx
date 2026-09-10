import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getProjectMembers } from "@/lib/data";
import { getWeeklyAlertDigest } from "@/lib/email/get-weekly-alert-digest";
import { formatDate, formatDateTime } from "@/lib/labels";

import { WeeklyDigestForm } from "./weekly-digest-form";

export const metadata: Metadata = { title: "Resumo semanal de alertas" };

export default async function WeeklyDigestPage({
  params,
}: {
  params: Promise<{ projectId: string; digestId: string }>;
}) {
  const { projectId, digestId } = await params;
  const [digest, members] = await Promise.all([
    getWeeklyAlertDigest(projectId, digestId),
    getProjectMembers(projectId),
  ]);

  if (!digest) {
    return (
      <Card>
        <CardHeader><CardTitle>Resumo semanal indisponível</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">O link não existe ou seu usuário não tem acesso a este resumo.</p>
          <Link href={`/${projectId}/acoes`} className={buttonVariants({ variant: "outline" })}>Voltar para Ações</Link>
        </CardContent>
      </Card>
    );
  }

  const activeMembers = members
    .filter((member) => member.status === "ACTIVE")
    .map((member) => ({ userId: member.userId, name: member.user.name }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-primary">ACC · AXION CONTROLE DE CONTRATOS</p>
        <h1 className="mt-1 text-2xl font-semibold">Resumo semanal — riscos médios e baixos</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {digest.projectName} · Semana de {formatDate(digest.weekDate)} · Destinatário: {digest.recipientName}
        </p>
      </div>

      {digest.status === "RESPONDED" ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <p className="font-medium text-emerald-700">Resumo respondido integralmente.</p>
            {digest.respondedAt ? <p className="text-sm text-muted-foreground">Registrado em {formatDateTime(digest.respondedAt)}.</p> : null}
            <Link href={`/${projectId}/acoes`} className={buttonVariants({ variant: "outline" })}>Ver Ações e Escalonamentos</Link>
          </CardContent>
        </Card>
      ) : digest.status !== "SENT" ? (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">Este resumo ainda não foi enviado ou está aguardando reprocessamento.</CardContent></Card>
      ) : (
        <>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            Selecione uma opção para cada alerta. O sistema só aceitará o envio quando todos estiverem respondidos.
          </div>
          <WeeklyDigestForm digestId={digest.id} projectId={projectId} items={digest.items} members={activeMembers} />
        </>
      )}
    </div>
  );
}
