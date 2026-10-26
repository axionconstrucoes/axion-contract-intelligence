"use server";

import { createSupabaseServerClient } from "@axion/db/server";

import { getCurrentProjectPermission } from "@/lib/contract-review";
import type { AlertConsultState } from "@/lib/ai/alert-consult/alert-consult-state";
import { runAlertConsultExpert } from "@/lib/ai/alert-consult/alert-consult-experts";
import { loadAlertConsultSubject } from "@/lib/ai/alert-consult/load-alert-consult-subject";
import { runAlertConsult } from "@/lib/ai/alert-consult/run-alert-consult";
import { parseAlertConsultForm } from "@/lib/ai/alert-consult/specialties";

// Consulta ao especialista de IA sobre UM alerta. SOMENTE LEITURA: nada é gravado — a consulta não
// altera o alerta, não registra providência e não envia nada. Abrir a página (GET) nunca chega
// aqui; só o envio explícito do formulário. Autorização (login + vínculo ativo com a obra) e
// isolamento por obra são conferidos no servidor; o navegador nunca vê chave nem outro projeto.
export async function consultAlertAction(_previous: AlertConsultState, formData: FormData): Promise<AlertConsultState> {
  const parsed = parseAlertConsultForm(formData);
  const echo = {
    question: String(formData.get("question") ?? ""),
    specialtyId: parsed.ok ? parsed.input.specialtyId : null,
  };
  if (!parsed.ok) return { result: null, error: parsed.error, ...echo };

  const supabase = await createSupabaseServerClient();
  const outcome = await runAlertConsult(
    {
      getPermission: getCurrentProjectPermission,
      loadSubject: (projectId, subject, id) => loadAlertConsultSubject(supabase, projectId, subject, id),
      runExpert: (expertId, request, userQuestion) => runAlertConsultExpert(supabase, expertId, request, userQuestion),
    },
    parsed.input
  );

  return outcome.ok
    ? { result: outcome, error: null, ...echo }
    : { result: null, error: outcome.error, ...echo };
}
