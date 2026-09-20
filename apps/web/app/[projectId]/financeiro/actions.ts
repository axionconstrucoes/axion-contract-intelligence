"use server";

// Server Action de correção humana da aba FINANCEIRO. Reutiliza a RPC
// GENÉRICA validate_weekly_report_sheet_values (nenhuma RPC duplicada):
// lê a aba pelo client de sessão (RLS + regra financeira), aplica a
// correção pontual sobre os dados extraídos e envia o conjunto corrigido;
// a RPC valida can_edit_project_financial_data, preserva o original
// (previous_value + data.original), registra usuário/data/justificativa
// e zera métricas para recálculo idempotente pelo worker.

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";
import type { EmailRegistryActionState } from "@/app/[projectId]/documentos/emails/actions-state";
import { getProjectFinancialAccess } from "@/lib/financial/access-server";
import { toNumericValue } from "@/lib/schedule/s-curve/detect-s-curve";
import type { FinancialColumnKey, FinancialSheetData } from "@/lib/schedule/weekly-report/types";

const COLUMN_KEYS: FinancialColumnKey[] = ["previsto", "realizado", "acumulado_previsto", "acumulado_realizado", "medido", "faturado", "recebido", "custo", "receita", "desembolso", "variacao"];

function requiredField(formData: FormData, name: string): string {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) throw new Error(`Campo obrigatório ausente: ${name}`);
  return value;
}

export async function correctFinancialValueAction(_prevState: EmailRegistryActionState, formData: FormData): Promise<EmailRegistryActionState> {
  const supabase = await createSupabaseServerClient();
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error("Sessão expirada. Faça login novamente.");
    const projectId = requiredField(formData, "projectId");
    const sheetId = requiredField(formData, "sheetId");
    const period = requiredField(formData, "period");
    const column = requiredField(formData, "column") as FinancialColumnKey;
    const rawValue = requiredField(formData, "value");
    const justification = requiredField(formData, "justification");
    if (!COLUMN_KEYS.includes(column)) throw new Error("Coluna inválida.");
    const financialAccess = await getProjectFinancialAccess({ projectId, userId: auth.user.id });
    if (!financialAccess.canView) throw new Error("Sem acesso financeiro neste projeto.");
    if (!financialAccess.canEdit) throw new Error("Sem permissão para corrigir dados financeiros neste projeto (necessário papel Administrador ou Gerente).");

    const value = toNumericValue(rawValue);
    if (value === null) throw new Error("Valor inválido — use formato brasileiro (1.234,56) ou negativo entre parênteses.");

    const { data: sheet, error } = await supabase.from("weekly_report_sheets").select("id,project_id,category,data,cutoff_date").eq("id", sheetId).eq("project_id", projectId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!sheet || sheet.category !== "FINANCEIRO") throw new Error("Aba Financeiro não encontrada.");
    const data = sheet.data as FinancialSheetData & { original?: unknown; humanCorrected?: boolean };
    if (!Array.isArray(data.rows)) throw new Error("Aba sem dados extraídos para corrigir.");
    const rowIndex = data.rows.findIndex((row) => row.period === period);
    if (rowIndex < 0) throw new Error("Período não encontrado na aba.");

    const rows = data.rows.map((row, index) => (index === rowIndex ? { ...row, values: { ...row.values, [column]: value } } : row));
    const corrected: FinancialSheetData & { corrections: unknown[] } = {
      unit: data.unit,
      columns: { ...data.columns, [column]: data.columns[column] ?? column },
      rows,
      headers: data.headers,
      corrections: [
        ...(((data as { corrections?: unknown[] }).corrections ?? []) as unknown[]),
        { period, column, previousValue: data.rows[rowIndex].values[column] ?? null, newValue: value, byUserId: auth.user.id, at: new Date().toISOString() },
      ],
    };

    const { error: rpcError } = await supabase.rpc("validate_weekly_report_sheet_values", {
      p_sheet_id: sheetId,
      p_data: corrected,
      p_cutoff_date: sheet.cutoff_date,
      p_justification: justification,
    });
    if (rpcError) throw new Error(rpcError.message);

    revalidatePath(`/${projectId}/financeiro`);
    return { error: null, success: true, message: "Correção registrada (original preservado, auditada); métricas serão recalculadas pelo worker." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao registrar a correção.", success: false, message: null };
  }
}
