import type { Metadata } from "next";

import { createSupabaseServerClient } from "@axion/db/server";
import type { AlertSeverity } from "@axion/types";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DELIVERY_ITEM_COLUMNS, toDeliveryItem, type DeliveryItemRow } from "@/lib/delivery/delivery-mappers";
import { DELIVERY_PHASE_LABELS } from "@/lib/delivery/delivery-items";

import { DeliveryAlertActionForm } from "./delivery-alert-action-form";

export const metadata: Metadata = { title: "Responder alerta de providência" };

const ACTION_LABELS = { RESOLVIDO: "RESOLVIDO", EM_ANDAMENTO: "EM ANDAMENTO", ENVIADO_PARA: "ENVIADO P/" } as const;

// Página de confirmação do alerta de providência. É SOMENTE LEITURA: abrir o link (GET) nunca
// registra nada — a ação só é efetivada pelo envio explícito do formulário (CONFIRMAR). O acesso
// segue a participação na obra (RLS): quem não participa vê "link inexistente ou sem acesso".
export default async function DeliveryAlertActionPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; itemId: string }>;
  searchParams: Promise<{ acao?: string | string[] }>;
}) {
  const { projectId, itemId } = await params;
  const query = await searchParams;
  const requested = Array.isArray(query.acao) ? query.acao[0] : query.acao;
  const action = requested && requested in ACTION_LABELS ? (requested as keyof typeof ACTION_LABELS) : null;

  const supabase = await createSupabaseServerClient();
  const [{ data: itemRow }, { data: project }, { data: memberRows }, { data: followup }] = await Promise.all([
    supabase.from("project_delivery_items").select(DELIVERY_ITEM_COLUMNS).eq("id", itemId).eq("project_id", projectId).maybeSingle(),
    supabase.from("projects").select("name").eq("id", projectId).maybeSingle(),
    supabase.from("project_memberships").select("user_id").eq("project_id", projectId).eq("status", "ACTIVE"),
    supabase
      .from("alert_followups")
      .select("severity,status")
      .eq("project_id", projectId)
      .eq("source_type", "DELIVERY_ITEM")
      .eq("source_id", itemId)
      .eq("status", "OPEN")
      .maybeSingle(),
  ]);

  const item = itemRow ? toDeliveryItem(itemRow as unknown as DeliveryItemRow) : null;
  const ids = (memberRows ?? []).map((m) => m.user_id as string);
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id,name").in("id", ids) : { data: [] };
  const members = (profiles ?? []).map((p) => ({ userId: p.id as string, name: (p.name as string) ?? "Colaborador" }));
  const severity = ((followup?.severity as AlertSeverity | undefined) ?? item?.risk ?? "MEDIA") as AlertSeverity;

  return (
    <div className="flex min-h-dvh items-start justify-center bg-muted p-3 sm:p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="gap-1 p-4 pb-3">
          <div className="mb-1 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/acc-logo.png" alt="ACC" className="h-7 w-auto" />
          </div>
          <CardTitle className="text-base">AXION Controle de Contratos</CardTitle>
          <CardDescription>Resposta rápida ao alerta de providência</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-4 pt-0">
          {!item || !project ? (
            <p className="text-sm text-destructive">Este link não existe ou seu usuário não tem acesso à providência.</p>
          ) : item.status === "CONCLUIDO" || item.status === "NAO_APLICAVEL" ? (
            <p className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800">Esta providência já está encerrada.</p>
          ) : !action ? (
            <p className="text-sm text-destructive">Ação inválida ou ausente.</p>
          ) : (
            <>
              <div className="grid gap-2 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_180px] md:items-center">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {project.name as string} · {DELIVERY_PHASE_LABELS[item.phase]}
                  </p>
                  <p className="text-sm font-semibold" title={item.title}>
                    {item.title}
                  </p>
                </div>
                <div className="md:text-right">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Ação</p>
                  <p className="text-sm font-semibold">{ACTION_LABELS[action]}</p>
                </div>
              </div>
              <DeliveryAlertActionForm projectId={projectId} itemId={itemId} action={action} severity={severity} members={members} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
