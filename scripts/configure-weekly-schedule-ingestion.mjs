// Configura (upsert) a ingestão semanal de cronograma de UM projeto —
// tudo vem dos argumentos: NENHUM domínio de cliente, remetente ou
// limite é fixo aqui nem no código de produção. Para o piloto, os
// valores específicos (ex.: domínio do cliente) são passados na linha
// de comando pelo administrador, nunca versionados.
//
// Escreve via service role (mesmo padrão dos demais scripts de
// configuração, ex.: configure-weg-project-relevance.mjs); o trigger de
// auditoria da migration registra a alteração como SYSTEM.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/configure-weekly-schedule-ingestion.mjs <projectId> \
//     --client-domains=cliente.example,outro.example \
//     [--client-addresses=a@cliente.example] \
//     [--sender-domain=axion.com.br] [--area=PLANEJAMENTO] [--tiers=FIRST_TIER,SECOND_TIER] \
//     [--deadline-weekday=5] [--deadline-time=18:00] [--timezone=America/Sao_Paulo] \
//     [--attachment-pattern=<regex>] [--alert-recipients=<uuid>,<uuid>] \
//     [--threshold=FINAL_DATE_SLIP_DAYS:3:7:15 ...] \
//     [--risk-alerts=on|off] [--pilot-recipients=<uuid>,<uuid>] \
//     [--severity-map=MISSING_WEEKLY_SCHEDULE:HIGH,...] [--confirm-pilot-project-by=<uuid>] \
//     [--enable | --disable] --apply
//
// ALERTAS DE RISCO (piloto): --risk-alerts liga/desliga os e-mails de
// alerta do projeto; --pilot-recipients define a allowlist POR user_id
// (somente esses usuários podem receber; qualquer outro indicado pela
// Matriz é registrado como PILOT_RECIPIENT_SUPPRESSED). Os user_ids são
// validados contra project_memberships ACTIVE antes de gravar. Prazos e
// níveis NÃO são configurados aqui: vêm da Matriz de responsabilidades e
// prazos. Remover a allowlist após o piloto: --pilot-recipients= (vazio).
//
// ESCALÃO: não é configurado aqui. Quem está no 1º/2º escalão de
// Planejamento vem exclusivamente da "Matriz de responsabilidades e
// prazos" (aba Usuários e permissões). --tiers só habilita/bloqueia.
// BASELINE: definida pela interface (RPC set_project_schedule_baseline),
// com justificativa e histórico — nunca por este script.

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

// Trava de deployment: sem ACC_WEEKLY_REPORTS_ENABLED=true a tabela de
// configuração pode não existir ainda — o script não toca no banco.
const { isWeeklyReportsEnabled, WEEKLY_REPORTS_FLAG_NAME } = await import("../apps/web/lib/feature-flags/weekly-reports");
if (!isWeeklyReportsEnabled()) {
  console.log(`[configure-weekly-schedule-ingestion] ${WEEKLY_REPORTS_FLAG_NAME} não é "true" — funcionalidade desativada; nada gravado.`);
  process.exit(0);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const projectId = args.find((arg) => !arg.startsWith("--"));

function option(name) {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
function list(name) {
  const value = option(name);
  return value === undefined ? undefined : value.split(",").map((item) => item.trim()).filter(Boolean);
}
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

if (!projectId) {
  console.error("ERRO: informe o projectId.");
  process.exit(1);
}

const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const payload = { project_id: projectId };
const clientDomains = list("client-domains");
const clientAddresses = list("client-addresses");
if (clientDomains) payload.client_recipient_domains = clientDomains.map((domain) => domain.toLowerCase().replace(/^@/, ""));
if (clientAddresses) payload.client_recipient_addresses = clientAddresses.map((address) => address.toLowerCase());
if (option("sender-domain")) payload.sender_domain = option("sender-domain").toLowerCase().replace(/^@/, "");
if (option("area")) payload.authorized_area = option("area");
if (list("tiers")) payload.authorized_tiers = list("tiers");
if (option("deadline-weekday")) payload.deadline_weekday = Number(option("deadline-weekday"));
if (option("deadline-time")) payload.deadline_time = option("deadline-time");
if (option("timezone")) payload.timezone = option("timezone");
if (option("attachment-pattern")) payload.attachment_name_pattern = option("attachment-pattern");
if (list("alert-recipients")) payload.alert_recipient_user_ids = list("alert-recipients");
if (option("monitoring-start")) payload.monitoring_start_at = option("monitoring-start");
if (option("monitoring-end")) payload.monitoring_end_at = option("monitoring-end");
if (args.includes("--enable")) payload.enabled = true;
if (args.includes("--disable")) payload.enabled = false;
if (option("risk-alerts") !== undefined) {
  if (!["on", "off"].includes(option("risk-alerts"))) throw new Error("--risk-alerts deve ser on|off");
  payload.risk_alerts_enabled = option("risk-alerts") === "on";
}
// Severidade dos alertas de ausência POR PROJETO (obrigatória para envio
// real): --severity-map=MISSING_WEEKLY_SCHEDULE:HIGH,MISSING_S_CURVE:MEDIUM,...
if (option("severity-map") !== undefined) {
  const map = {};
  // Só ALERTAS DE AUSÊNCIA entram no mapa; divergências classificadas pelo
  // motor (S_CURVE_MPP_DIVERGENCE, BASELINE_SHEET_DIVERGENCE) nunca — a
  // severidade delas é do motor e não pode ser rebaixada/elevada aqui.
  const ABSENCE_KINDS = ["MISSING_WEEKLY_SCHEDULE", "MISSING_WEEKLY_REPORT_WORKBOOK", "MISSING_S_CURVE"];
  for (const pair of list("severity-map") ?? []) {
    const [kind, level] = pair.split(":");
    if (!kind || !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(level)) throw new Error(`--severity-map inválido: ${pair}`);
    if (!ABSENCE_KINDS.includes(kind)) throw new Error(`--severity-map: tipo não admitido no mapa (${kind}) — só alertas de ausência: ${ABSENCE_KINDS.join(", ")}`);
    map[kind] = level;
  }
  for (const kind of ABSENCE_KINDS) {
    if (Object.keys(map).length && !map[kind]) throw new Error(`--severity-map incompleto: falta ${kind}`);
  }
  payload.risk_alert_severity_map = Object.keys(map).length ? map : null;
}
// Confirmação HUMANA do projeto piloto real (nunca automática):
// --confirm-pilot-project-by=<user_id do administrador que confirma>.
if (option("confirm-pilot-project-by")) {
  payload.pilot_project_confirmed_at = new Date().toISOString();
  payload.pilot_project_confirmed_by_user_id = option("confirm-pilot-project-by");
}
const pilotRecipients = list("pilot-recipients");
if (pilotRecipients !== undefined) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (pilotRecipients.some((id) => !UUID.test(id))) throw new Error("--pilot-recipients aceita somente user_ids (uuid), nunca e-mails");
  payload.pilot_recipient_allowlist_user_ids = pilotRecipients.length ? pilotRecipients : null;
}

const thresholds = args
  .filter((arg) => arg.startsWith("--threshold="))
  .map((arg) => arg.slice("--threshold=".length).split(":"))
  .map(([dimension, medium, high, critical]) => ({
    dimension,
    medium_threshold: Number(medium),
    high_threshold: Number(high),
    critical_threshold: Number(critical),
  }));

console.log("");
console.log("CONFIGURAÇÃO — INGESTÃO SEMANAL DE CRONOGRAMA");
console.log("Projeto:", projectId);
console.log("Modo:", apply ? "APLICAR" : "SIMULAÇÃO (--apply para gravar)");
console.log("Config:", JSON.stringify(payload, null, 2));
if (thresholds.length) console.log("Limites de risco:", JSON.stringify(thresholds));

if (!apply) process.exit(0);

// Allowlist do piloto: cada user_id precisa ter membership ACTIVE no projeto.
if (payload.pilot_recipient_allowlist_user_ids) {
  const { data: members, error: membersError } = await supabase
    .from("project_memberships")
    .select("user_id,status")
    .eq("project_id", projectId)
    .in("user_id", payload.pilot_recipient_allowlist_user_ids);
  if (membersError) throw new Error(membersError.message);
  const active = new Set((members ?? []).filter((m) => m.status === "ACTIVE").map((m) => m.user_id));
  const invalid = payload.pilot_recipient_allowlist_user_ids.filter((id) => !active.has(id));
  if (invalid.length) throw new Error(`Allowlist inválida — sem membership ACTIVE no projeto: ${invalid.join(", ")}`);
}

const { data: config, error: configError } = await supabase
  .from("project_weekly_schedule_ingestion_configs")
  .upsert(payload, { onConflict: "project_id" })
  .select("id,project_id,enabled")
  .single();
if (configError) throw new Error(configError.message);

for (const threshold of thresholds) {
  const { error } = await supabase
    .from("project_schedule_risk_thresholds")
    .upsert({ project_id: projectId, ...threshold }, { onConflict: "project_id,dimension" });
  if (error) throw new Error(`Limite ${threshold.dimension}: ${error.message}`);
}

console.log("");
console.log("Configuração gravada:", JSON.stringify(config));
