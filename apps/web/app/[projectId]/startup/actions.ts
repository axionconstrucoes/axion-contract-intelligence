"use server";

// Server Actions do Start-up ACC. Toda escrita passa pelo client de
// sessão (createSupabaseServerClient) — nunca service-role — para que a
// RLS (EDITOR + auth.uid() como autor) seja a única autoridade real
// sobre quem pode decidir finding/criar ação/concluir Start-up.

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";
import { configureProjectStartup } from "@/lib/startup/configure-startup";
import { dismissHistoricalFinding } from "@/lib/startup/dismiss-historical-finding";
import { resolveHistoricalFinding } from "@/lib/startup/resolve-historical-finding";
import { createActionForHistoricalFinding } from "@/lib/startup/create-action-for-historical-finding";
import { completeProjectStartup } from "@/lib/startup/complete-startup";
import type { SlaArea } from "@/lib/sla/types";
import type {
  CompleteStartupState,
  ConfigureStartupState,
  CreateActionForFindingState,
  DismissFindingState,
  ResolveFindingState,
} from "./actions-state";

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

function requiredField(formData: FormData, name: string): string {
  const value = optionalField(formData, name);
  if (!value) throw new Error(`Campo obrigatório ausente: ${name}`);
  return value;
}

async function requireUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Sessão expirada. Faça login novamente.");
  return data.user;
}

export async function configureStartupAction(_prevState: ConfigureStartupState, formData: FormData): Promise<ConfigureStartupState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");

    await configureProjectStartup(supabase, {
      projectId,
      projectStartDate: requiredField(formData, "projectStartDate"),
      accOperationalStartDate: optionalField(formData, "accOperationalStartDate") ?? undefined,
    });

    revalidatePath(`/${projectId}/startup`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao configurar Start-up.", success: false };
  }
}

export async function dismissFindingAction(_prevState: DismissFindingState, formData: FormData): Promise<DismissFindingState> {
  const supabase = await createSupabaseServerClient();
  try {
    const user = await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");

    await dismissHistoricalFinding(supabase, {
      findingId: requiredField(formData, "findingId"),
      justification: requiredField(formData, "justification"),
      reviewedByUserId: user.id,
    });

    revalidatePath(`/${projectId}/startup`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao desconsiderar finding.", success: false };
  }
}

export async function resolveFindingAction(_prevState: ResolveFindingState, formData: FormData): Promise<ResolveFindingState> {
  const supabase = await createSupabaseServerClient();
  try {
    const user = await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");

    await resolveHistoricalFinding(supabase, {
      findingId: requiredField(formData, "findingId"),
      description: requiredField(formData, "description"),
      approximateDate: optionalField(formData, "approximateDate"),
      evidenceNote: optionalField(formData, "evidenceNote"),
      reviewedByUserId: user.id,
    });

    revalidatePath(`/${projectId}/startup`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao marcar finding como pacificado.", success: false };
  }
}

export async function createActionForFindingAction(
  _prevState: CreateActionForFindingState,
  formData: FormData
): Promise<CreateActionForFindingState> {
  const supabase = await createSupabaseServerClient();
  try {
    const user = await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");

    await createActionForHistoricalFinding(supabase, {
      findingId: requiredField(formData, "findingId"),
      projectId,
      responsibleUserId: requiredField(formData, "responsibleUserId"),
      area: requiredField(formData, "area") as SlaArea,
      actionDescription: requiredField(formData, "actionDescription"),
      dueAt: optionalField(formData, "dueAt"),
      note: optionalField(formData, "note"),
      createdByUserId: user.id,
    });

    revalidatePath(`/${projectId}/startup`);
    revalidatePath(`/${projectId}/acoes`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao criar ação.", success: false };
  }
}

export async function completeStartupAction(_prevState: CompleteStartupState, formData: FormData): Promise<CompleteStartupState> {
  const supabase = await createSupabaseServerClient();
  try {
    const user = await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");

    await completeProjectStartup(supabase, { projectId, completedByUserId: user.id });

    revalidatePath(`/${projectId}/startup`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao concluir Start-up.", success: false };
  }
}
