// Providências: plano de varredura de alertas (D−60 / prazo individual / início / sem responsável),
// integração com o acompanhamento recorrente e segurança das páginas (verificações estruturais).
// Sem banco, rede ou envio.
//
// Uso: node scripts/test-delivery-integration.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const D = await import("../apps/web/lib/delivery/delivery-items.ts");
const Plan = await import("../apps/web/lib/delivery/delivery-alert-plan.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.join(here, "..", p), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}

const END = "2027-08-15";
const NOW = new Date("2027-07-01T15:00:00Z");
const TODAY = "2027-07-01";
const list = D.buildInitialChecklist((k) => `id-${k}`);
const item = (key, over = {}) => ({ ...list.find((i) => i.checklistKey === key), ...over });
const plan = (items, over = {}) =>
  Plan.planDeliveryFollowups({ items, projectEndDay: END, today: TODAY, now: NOW, trackedItemIds: new Set(), fallbackAdminUserId: "u-adm", ...over });

console.log("");
console.log("======================================");
console.log("PROVIDÊNCIAS — VARREDURA E INTEGRAÇÃO");
console.log("======================================");
console.log("");

check("dentro da janela (hoje 2027-07-01, término 2027-08-15): todos os 13 itens de entrega abertos são devidos; o de INÍCIO sem prazo só por falta de responsável", () => {
  const r = plan(list);
  const entrega = r.toOpen.filter((p) => p.reason !== "INICIO");
  assert.equal(entrega.length, 13);
  assert.ok(entrega.every((p) => p.reason === "D_MENOS_60"));
  const inicio = r.toOpen.filter((p) => p.reason === "INICIO");
  assert.equal(inicio.length, 1, "CNO sem responsável alerta já, sem esperar D−60");
  assert.equal(inicio[0].itemId, "id-CNO");
});

check("antes da janela nada de ENTREGA é devido (término 2027-12-15) — CNO continua alertando por falta de responsável", () => {
  const r = plan(list, { projectEndDay: "2027-12-15" });
  assert.deepEqual(r.toOpen.map((p) => p.reason), ["INICIO"]);
});

check("sem data final: nenhum alerta de entrega; prazo individual vencendo ainda gera alerta", () => {
  assert.equal(plan(list.filter((i) => i.phase === "ENTREGA"), { projectEndDay: null }).toOpen.length, 0);
  const r = plan([item("AVCB", { deadline: "2027-07-01", responsibleUserId: "u-ana" })], { projectEndDay: null });
  assert.equal(r.toOpen.length, 1);
  assert.equal(r.toOpen[0].reason, "PRAZO_INDIVIDUAL");
  assert.equal(r.toOpen[0].responsibleUserId, "u-ana");
});

check("destinatário: o responsável do item; sem responsável, o administrador da obra; sem nenhum dos dois, o item é ignorado (e contado)", () => {
  const a = plan([item("AVCB", { responsibleUserId: "u-ana" }), item("AS_BUILT")]);
  assert.deepEqual(a.toOpen.map((p) => [p.itemId, p.responsibleUserId]), [["id-AVCB", "u-ana"], ["id-AS_BUILT", "u-adm"]]);
  const b = plan([item("AS_BUILT")], { fallbackAdminUserId: null });
  assert.equal(b.toOpen.length, 0);
  assert.equal(b.skippedNoRecipient, 1);
});

check("idempotência: item que já tem acompanhamento aberto não é aberto de novo", () => {
  const r = plan([item("AVCB"), item("AS_BUILT")], { trackedItemIds: new Set(["id-AVCB"]) });
  assert.deepEqual(r.toOpen.map((p) => p.itemId), ["id-AS_BUILT"]);
  assert.equal(r.alreadyTracked, 1);
});

check("grau de risco: o escolhido (1/2/4/7 dias) ou MÉDIO se não definido — nunca crítico por padrão; 1º lembrete devido AGORA", () => {
  const r = plan([item("AVCB", { risk: "CRITICA" }), item("AS_BUILT"), item("DATABOOK", { risk: "BAIXA" })]);
  const byId = Object.fromEntries(r.toOpen.map((p) => [p.itemId, p]));
  assert.equal(byId["id-AVCB"].severity, "CRITICA");
  assert.equal(byId["id-AS_BUILT"].severity, "MEDIA");
  assert.equal(byId["id-DATABOOK"].severity, "BAIXA");
  const hours = { CRITICA: 24, MEDIA: 96, BAIXA: 168 };
  for (const p of r.toOpen) {
    const sentAt = new Date(p.sentAt).getTime();
    assert.equal(sentAt + hours[p.severity] * 3600e3, NOW.getTime(), "sentAt + intervalo = agora");
  }
  assert.ok(Object.values(byId).filter((p) => p.severity === "CRITICA").length === 1, "só o item marcado como crítico é crítico");
});

check("itens concluídos e não aplicáveis nunca entram no plano", () => {
  const r = plan([item("AVCB", { status: "CONCLUIDO" }), item("ISS", { status: "NAO_APLICAVEL" })]);
  assert.equal(r.toOpen.length, 0);
  assert.equal(r.due, 0);
});

check("CNO: atraso e proximidade do prazo geram alerta mesmo com responsável; prazo longe e responsável definido não geram", () => {
  const cno = (over) => plan([item("CNO", { responsibleUserId: "u-ana", ...over })]);
  assert.equal(cno({ deadline: "2027-06-20" }).toOpen.length, 1);
  assert.equal(cno({ deadline: "2027-07-05" }).toOpen.length, 1);
  assert.equal(cno({ deadline: "2027-09-30" }).toOpen.length, 0);
  assert.equal(cno({}).toOpen.length, 0);
});

// ---------- estrutura / segurança ----------

check("tabela e alertas compartilham o MESMO registro: funções SQL encaminham/resolvem o acompanhamento; a varredura só abre", () => {
  const sql = src("supabase/migrations/20261027130000_project_delivery_items.sql");
  assert.ok(sql.includes("update public.alert_followups") && sql.includes("source_type = 'DELIVERY_ITEM'"));
  assert.ok(sql.includes("status = 'RESOLVED'"));
  const scan = src("apps/web/lib/delivery/delivery-alert-scan.ts");
  assert.ok(scan.includes('admin.rpc("alert_followup_open"'));
  assert.ok(!/getEmailProvider|\.send\(/.test(scan), "a varredura nunca envia e-mail");
});

check("ações da tabela só gravam por funções SQL com sessão do usuário (permissão e regras no banco)", () => {
  const actions = src("apps/web/app/[projectId]/providencias/actions.ts");
  assert.ok(!/\.(insert|update|delete|upsert)\(/.test(actions));
  for (const fn of ["delivery_items_seed_checklist", "delivery_item_add_custom", "delivery_item_update_fields", "delivery_item_change_status"]) assert.ok(actions.includes(fn), fn);
  assert.ok(!actions.includes("createSupabaseAdminClient"));
});

check("página de providências: leitura apenas (GET não altera nada); edição só aparece para quem pode editar; migration ausente degrada sem erro", () => {
  const page = src("apps/web/app/[projectId]/providencias/page.tsx");
  assert.ok(!/\.rpc\(|\.insert\(|\.update\(|\.delete\(/.test(page));
  assert.ok(page.includes("overview.canEdit ?"));
  assert.ok(page.includes("migration das providências não foi aplicada"));
  const data = src("apps/web/lib/delivery/delivery-data.ts");
  assert.ok(data.includes("42P01"));
  assert.ok(data.includes('permission === "ADMINISTRADOR" || permission === "GESTOR" || permission === "GERENTE"'));
});

check("lembrete de providência: responsável ATUAL, caixa por risco com 'Repete', link abre a linha da tabela, sem controles duplicados no e-mail", () => {
  const m = src("apps/web/lib/alerts/delivery-item-reminder-mailer.ts");
  assert.ok(m.includes("message.recipientUserId"));
  assert.ok(m.includes("repeatNotice: true"));
  assert.ok(m.includes("actionButtons: []"));
  assert.ok(m.includes("/providencias#item-"));
  assert.ok(m.includes("getEmailProvider().send("), "envio pelo provider (guard do piloto)");
  assert.ok(m.includes('"PROVIDENCIA_ENCERRADA"'));
  const run = src("apps/web/lib/alerts/run-alert-reminders.ts");
  assert.ok(run.includes('sourceType === "DELIVERY_ITEM"'));
  assert.ok(run.indexOf("scanDeliveryAlerts(") < run.indexOf("runReminderCycle("), "varredura antes do ciclo");
  assert.ok(run.includes("VARREDURA_FALHOU"), "falha na varredura não impede os lembretes");
});

check("navegação: item Providências na sidebar com ajuda registrada", () => {
  assert.ok(src("apps/web/lib/ui/nav-items.ts").includes('href: "providencias"'));
  assert.ok(src("apps/web/lib/ui/feature-help.ts").includes('id: "providencias"'));
});

check("editor: registrar evidência avisa que não conclui; concluir exige perfil autorizado (texto) e o banco confere", () => {
  const ed = src("apps/web/components/delivery/delivery-item-editor.tsx");
  assert.ok(ed.includes("Registrar a evidência não conclui a providência."));
  assert.ok(ed.includes("Concluir exige gestor, gerente ou administrador"));
  assert.ok(ed.includes("colaborador ativo da obra"));
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
