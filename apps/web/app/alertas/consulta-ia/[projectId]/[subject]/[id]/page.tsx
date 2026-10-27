import type { Metadata } from "next";

import { createSupabaseServerClient } from "@axion/db/server";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadAlertConsultSubject } from "@/lib/ai/alert-consult/load-alert-consult-subject";
import { getAlertConsultSpecialty, preselectSpecialtyForArea } from "@/lib/ai/alert-consult/specialties";
import { getCurrentProjectPermission } from "@/lib/contract-review";

import { consultAlertAction } from "./actions";
import { AlertConsultPanel } from "./alert-consult-panel";

export const metadata: Metadata = { title: "Consultar IA — alerta" };

// Página da consulta ao especialista de IA. É SOMENTE LEITURA: abrir o link do e-mail (GET) nunca
// consulta o modelo, nunca grava e nunca altera o alerta — a consulta só ocorre pelo botão
// "Consultar" (envio explícito). Exige login e vínculo ativo com a obra do alerta; o alerta é
// carregado por obra, então um id de outra obra aparece como "inexistente ou sem acesso".
export default async function AlertConsultPage({ params }: { params: Promise<{ projectId: string; subject: string; id: string }> }) {
  const { projectId, subject, id } = await params;
  const kind = subject === "evento" || subject === "providencia" ? subject : null;

  const supabase = await createSupabaseServerClient();
  const permission = kind ? await getCurrentProjectPermission(projectId) : null;
  const loaded = kind && permission ? await loadAlertConsultSubject(supabase, projectId, kind, id) : null;

  let area: string | null = null;
  if (loaded) {
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      const { data: membership } = await supabase
        .from("project_memberships")
        .select("area")
        .eq("project_id", projectId)
        .eq("user_id", auth.user.id)
        .eq("status", "ACTIVE")
        .maybeSingle();
      area = (membership?.area as string | null | undefined) ?? null;
    }
  }

  const defaultSpecialtyId = preselectSpecialtyForArea(area);
  const defaultLabel = getAlertConsultSpecialty(defaultSpecialtyId)?.label ?? "Geral";
  const areaNote = area
    ? defaultSpecialtyId === "geral"
      ? `Sua área cadastrada (${area}) não tem especialista correspondente; selecionamos “Geral”.`
      : `Selecionado pela sua área cadastrada (${area}): ${defaultLabel}.`
    : "Você não tem área cadastrada nesta obra; selecionamos “Geral”.";

  return (
    <div className="flex min-h-dvh items-start justify-center bg-muted p-3 sm:p-4">
      <Card className="w-full max-w-3xl">
        <CardHeader className="gap-1 p-4 pb-3">
          <div className="mb-1 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/acc-logo.png" alt="ACC" className="h-7 w-auto" />
          </div>
          <CardTitle className="text-base">AXION Controle de Contratos</CardTitle>
          <CardDescription>Consultar IA sobre o alerta</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4 pt-0">
          {!loaded ? (
            <p className="text-sm text-destructive">Este link não existe ou seu usuário não tem acesso ao alerta.</p>
          ) : (
            <>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  {loaded.projectName} · {loaded.subject === "evento" ? "Alerta de evento contratual" : "Alerta de providência"}
                </p>
                <p className="text-sm font-semibold">{loaded.title}</p>
              </div>
              <AlertConsultPanel
                action={consultAlertAction}
                projectId={projectId}
                subject={loaded.subject}
                id={loaded.id}
                defaultSpecialtyId={defaultSpecialtyId}
                areaNote={areaNote}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
