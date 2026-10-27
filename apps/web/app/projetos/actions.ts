"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@axion/db/server";
import { createSupabaseAdminClient } from "@axion/db/admin";
import {
  editProjectReturnPath,
  type CreateProjectState,
  type EditProjectOrigin,
  type UpdateProjectState,
} from "./actions-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requiredField(formData: FormData, field: string): string {
  const value = String(formData.get(field) ?? "").trim();
  if (!value) throw new Error("Preencha todos os campos obrigatórios.");
  return value;
}

export async function createProjectAction(
  _previousState: CreateProjectState,
  formData: FormData
): Promise<CreateProjectState> {
  const supabase = await createSupabaseServerClient();

  try {
    const code = requiredField(formData, "code").toUpperCase();
    const name = requiredField(formData, "name");
    const client = requiredField(formData, "client");
    const location = requiredField(formData, "location");
    const startDate = requiredField(formData, "startDate");
    const baselineEndDate = requiredField(formData, "baselineEndDate");

    if (code.length > 40 || name.length > 160 || client.length > 120 || location.length > 160) {
      throw new Error("Revise os campos: algum texto excede o tamanho permitido.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(baselineEndDate)) {
      throw new Error("Informe datas válidas de início e término.");
    }
    if (baselineEndDate < startDate) {
      throw new Error("A data de término deve ser igual ou posterior à data de início.");
    }

    const { data: projectId, error } = await supabase.rpc("create_project_workspace", {
      p_code: code,
      p_name: name,
      p_client: client,
      p_location: location,
      p_start_date: startDate,
      p_baseline_end_date: baselineEndDate,
    });

    if (error) {
      if (error.code === "23505") return { error: "Este No. sistema UNO já está cadastrado no ACC." };
      return { error: error.message };
    }
    if (!projectId) return { error: "O ACC não retornou o projeto criado. Tente novamente." };

    revalidatePath("/projetos");
    redirect(`/${projectId}/startup`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    return { error: error instanceof Error ? error.message : "Não foi possível criar o projeto." };
  }
}

// ---------- Edição dos dados cadastrais ----------

type EditableProjectFields = {
  name: string;
  code: string;
  client: string;
  location: string;
  contract_number: string | null;
  start_date: string;
  baseline_end_date: string;
};

const EDITABLE_FIELD_LABELS: Record<keyof EditableProjectFields, string> = {
  name: "Nome",
  code: "No. sistema UNO",
  client: "Cliente",
  location: "Localização",
  contract_number: "Contrato",
  start_date: "Início",
  baseline_end_date: "Término baseline",
};

function readEditableFields(formData: FormData): EditableProjectFields {
  const name = requiredField(formData, "name");
  const code = requiredField(formData, "code").toUpperCase();
  const client = requiredField(formData, "client");
  const location = requiredField(formData, "location");
  const contractNumber = String(formData.get("contractNumber") ?? "").trim();
  const startDate = requiredField(formData, "startDate");
  const baselineEndDate = requiredField(formData, "baselineEndDate");

  if (code.length > 40 || name.length > 160 || client.length > 120 || location.length > 160 || contractNumber.length > 80) {
    throw new Error("Revise os campos: algum texto excede o tamanho permitido.");
  }
  if (!ISO_DATE_PATTERN.test(startDate) || !ISO_DATE_PATTERN.test(baselineEndDate)) {
    throw new Error("Informe datas válidas de início e término.");
  }
  if (baselineEndDate < startDate) {
    throw new Error("A data de término deve ser igual ou posterior à data de início.");
  }

  return {
    name,
    code,
    client,
    location,
    contract_number: contractNumber || null,
    start_date: startDate,
    baseline_end_date: baselineEndDate,
  };
}

export async function updateProjectAction(
  _previousState: UpdateProjectState,
  formData: FormData
): Promise<UpdateProjectState> {
  const projectId = String(formData.get("projectId") ?? "");
  const origin: EditProjectOrigin = formData.get("origin") === "projeto" ? "projeto" : "selecao";
  if (!UUID_PATTERN.test(projectId)) return { error: "Projeto inválido." };

  const supabase = await createSupabaseServerClient();

  try {
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;
    if (!user) return { error: "Sessão expirada. Entre novamente no ACC." };

    // Mesma regra da RLS (projects_update_editor → has_project_permission):
    // somente ADMINISTRADOR ativo do próprio projeto edita o cadastro.
    const { data: membership } = await supabase
      .from("project_memberships")
      .select("permission, status")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (membership?.status !== "ACTIVE" || membership.permission !== "ADMINISTRADOR") {
      return { error: "Somente administradores ativos deste projeto podem editar o cadastro." };
    }

    const fields = readEditableFields(formData);

    const { data: current, error: currentError } = await supabase
      .from("projects")
      .select("name, code, client, location, contract_number, start_date, baseline_end_date")
      .eq("id", projectId)
      .maybeSingle();
    if (currentError) return { error: currentError.message };
    if (!current) return { error: "Projeto não encontrado." };

    const changes = (Object.keys(fields) as (keyof EditableProjectFields)[]).filter(
      (key) => (current[key] ?? null) !== fields[key]
    );

    if (changes.length > 0) {
      // Somente as colunas cadastrais — id, vínculos, status e datas do
      // Start-up nunca são tocados por esta edição.
      const { data: updated, error: updateError } = await supabase
        .from("projects")
        .update(fields)
        .eq("id", projectId)
        .select("id");

      if (updateError) {
        if (updateError.code === "23505") return { error: "Este No. sistema UNO já está cadastrado em outro projeto do ACC." };
        return { error: updateError.message };
      }
      if (!updated?.length) return { error: "Você não tem permissão para editar este projeto." };

      // audit_log_entries não tem policy de INSERT para o client
      // autenticado — mesmo padrão das demais trilhas server-side do ACC.
      const detail = changes
        .map((key) => `${EDITABLE_FIELD_LABELS[key]}: "${current[key] ?? "—"}" -> "${fields[key] ?? "—"}"`)
        .join("; ");
      const { error: auditError } = await createSupabaseAdminClient().from("audit_log_entries").insert({
        project_id: projectId,
        actor_type: "USER",
        actor_user_id: user.id,
        actor_label: null,
        action: "PROJECT_UPDATED",
        entity_type: "PROJECT",
        entity_id: projectId,
        detail: `Cadastro do projeto alterado. ${detail}.`,
      });
      if (auditError) {
        return { error: `Alterações salvas, mas a auditoria falhou: ${auditError.message}. Avise o administrador do ACC.` };
      }

      // Seletor (top bar), lista de projetos e Dashboard leem o cadastro
      // em cada render — invalida todas as rotas abaixo do layout raiz.
      revalidatePath("/", "layout");
    }

    redirect(editProjectReturnPath(projectId, origin));
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    return { error: error instanceof Error ? error.message : "Não foi possível salvar as alterações." };
  }
}
