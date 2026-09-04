"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseAdminClient } from "@axion/db/admin";
import { createSupabaseServerClient } from "@axion/db/server";

import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getEvent, getUser } from "@/lib/data";
import { persistCurationAudit } from "@/lib/ai/curation/persist-curation-audit";
import { runMultiExpertCuration } from "@/lib/ai/curation/run-multi-expert-curation";
import type { MultiExpertCuration } from "@/lib/ai/curation/types";
import type { RunMultiExpertCurationState } from "./run-multi-expert-curation-actions-state";

// Este módulo é "use server" — só pode exportar funções async (Server
// Actions). Tipo e estado inicial vivem em
// ./run-multi-expert-curation-actions-state.ts.

// Gatilho MANUAL (nunca automático) da curadoria multiagente já
// existente (apps/web/lib/ai/curation/run-multi-expert-curation.ts) —
// mesmo padrão de "IA prepara → humano dispara → resultado gravado e
// rastreável" já usado por assessScheduleDelayAction. Nenhuma lógica de
// Expert é reimplementada aqui: esta Server Action só resolve
// permissão/contexto do evento, chama o motor existente e persiste 1
// linha de auditoria (persistCurationAudit) — nunca decide nada sozinha.
export async function runMultiExpertCurationAction(
  _prevState: RunMultiExpertCurationState,
  formData: FormData
): Promise<RunMultiExpertCurationState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const eventId = String(formData.get("eventId") ?? "").trim();

  if (!projectId || !eventId) {
    return { error: "Dados do evento ausentes. Recarregue a página e tente novamente.", success: null };
  }

  // Mesmo nível de permissão já exigido por assessScheduleDelayAction —
  // dispara Experts de IA reais (custo/sensibilidade), não é uma leitura
  // trivial. Revalidado aqui mesmo que a UI já esconda o botão para
  // quem não tem essa permissão (a Server Action é a fonte de verdade).
  const permission = await getCurrentProjectPermission(projectId);
  if (permission !== "ADMINISTRADOR" && permission !== "GESTOR" && permission !== "GERENTE") {
    return { error: "Executar a curadoria multiagente exige permissão GERENTE ou ADMINISTRADOR no projeto.", success: null };
  }

  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { error: "Sessão expirada. Faça login novamente.", success: null };
  }

  const event = await getEvent(eventId);
  if (!event || event.projectId !== projectId) {
    return { error: "Evento não encontrado.", success: null };
  }

  let curation: MultiExpertCuration;
  try {
    // description nunca é inventada: é sempre o título + descrição REAIS
    // já registrados no evento (nunca um texto digitado à parte só para
    // este gatilho) — o roteamento por palavra-chave (route-experts.ts)
    // classifica em cima do que o evento realmente diz.
    curation = await runMultiExpertCuration(supabase, {
      projectId,
      sourceType: "EVENT",
      eventId,
      description: `${event.title}\n${event.description}`,
    });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao executar a curadoria multiagente.",
      success: null,
    };
  }

  const triggeredByProfile = await getUser(authData.user.id);

  try {
    const admin = createSupabaseAdminClient();
    await persistCurationAudit(admin, {
      curation,
      triggeredByUserId: authData.user.id,
      triggeredByLabel: triggeredByProfile?.name ?? "usuário não identificado",
    });
  } catch (error) {
    // A análise já foi produzida e é mostrada ao usuário mesmo se o
    // registro de auditoria falhar — nunca esconder um resultado válido
    // por causa disso, mas o erro é reportado explicitamente (nunca
    // silencioso) para quem disparou a ação.
    return {
      error: `Análise concluída, mas falhou ao registrar auditoria: ${error instanceof Error ? error.message : "erro desconhecido"}.`,
      success: curation,
    };
  }

  revalidatePath(`/${projectId}/ledger/${eventId}`);
  revalidatePath(`/${projectId}/auditoria`);

  return { error: null, success: curation };
}
