import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

import { getCurrentProjectPermission } from "@/lib/contract-review";

import type { DeliveryItem } from "./delivery-items";
import { DELIVERY_ITEM_COLUMNS, toDeliveryItem, type DeliveryItemRow } from "./delivery-mappers";

export interface DeliveryMember {
  userId: string;
  name: string;
}

export interface DeliveryOverview {
  /** false quando a migration ainda não foi aplicada neste ambiente. */
  available: boolean;
  projectName: string;
  /** Término previsto da obra (AAAA-MM-DD) ou null. */
  projectEndDay: string | null;
  /** Início da obra cadastrado (AAAA-MM-DD) ou null. */
  projectStartDay: string | null;
  /** Datas de início cadastradas e distintas (start_date x project_start_date): >1 = divergência. */
  startCandidates: string[];
  items: DeliveryItem[];
  members: DeliveryMember[];
  canEdit: boolean;
}

const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205", "PGRST200"]);

export async function getDeliveryOverview(projectId: string): Promise<DeliveryOverview | null> {
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id,name,start_date,project_start_date,baseline_end_date")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;

  const [{ data: itemRows, error: itemsError }, { data: memberRows }, permission] = await Promise.all([
    supabase.from("project_delivery_items").select(DELIVERY_ITEM_COLUMNS).eq("project_id", projectId).order("created_at", { ascending: true }),
    supabase.from("project_memberships").select("user_id,status").eq("project_id", projectId).eq("status", "ACTIVE"),
    getCurrentProjectPermission(projectId),
  ]);

  const base = {
    projectName: project.name as string,
    projectEndDay: project.baseline_end_date ? String(project.baseline_end_date).slice(0, 10) : null,
    projectStartDay: project.start_date ? String(project.start_date).slice(0, 10) : null,
    startCandidates: Array.from(
      new Set([project.start_date, project.project_start_date].filter(Boolean).map((d) => String(d).slice(0, 10)))
    ),
  };

  if (itemsError) {
    if (MISSING_TABLE_CODES.has(itemsError.code ?? "")) {
      return { available: false, ...base, items: [], members: [], canEdit: false };
    }
    throw new Error("Falha ao carregar as providências da obra.");
  }

  const ids = (memberRows ?? []).map((m) => m.user_id as string);
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id,name").in("id", ids) : { data: [] };
  const members = (profiles ?? []).map((p) => ({ userId: p.id as string, name: (p.name as string) ?? "Colaborador" }));

  return {
    available: true,
    ...base,
    items: ((itemRows ?? []) as unknown as DeliveryItemRow[]).map(toDeliveryItem),
    members,
    canEdit: permission === "ADMINISTRADOR" || permission === "GESTOR" || permission === "GERENTE",
  };
}
