// Providências e pendências para entrega: regras da tabela, marco D−60, prazos individuais e CNO.
// Datas AAAA-MM-DD simuladas; nada acessa banco, rede ou provedor.
//
// Uso: node scripts/test-delivery-items.mjs

import assert from "node:assert/strict";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const D = await import("../apps/web/lib/delivery/delivery-items.ts");

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

const NOW = "2027-01-10T12:00:00Z";
const END = "2027-08-15"; // término previsto da obra
const mk = (over = {}) => ({ ...D.buildInitialChecklist((k) => `id-${k}`).find((i) => i.checklistKey === "AS_BUILT"), ...over });

console.log("");
console.log("======================================");
console.log("PROVIDÊNCIAS DA OBRA — REGRAS");
console.log("======================================");
console.log("");

check("checklist inicial: 14 itens configuráveis, CNO na fase de INÍCIO, nada preenchido nem confirmado", () => {
  const list = D.buildInitialChecklist((k) => `id-${k}`);
  assert.equal(list.length, 14);
  const titles = list.map((i) => i.title);
  for (const t of [
    "Inscrição da obra no CNO — matrícula da obra no INSS", "As-built", "Databook — consolidação final", "Catálogos e manuais",
    "Termos de garantia", "Notas fiscais pertinentes ao databook", "Quitação/regularização do ISS",
    "AVCB — Auto de Vistoria do Corpo de Bombeiros", "Água: pedido protocolado", "Água: ligação efetivada",
    "Esgoto: pedido protocolado", "Esgoto: ligação efetivada", "Energia: pedido protocolado", "Energia: ligação efetivada",
  ]) assert.ok(titles.includes(t), t);
  assert.equal(list.find((i) => i.checklistKey === "CNO").phase, "INICIO");
  assert.equal(list.filter((i) => i.phase === "ENTREGA").length, 13);
  for (const i of list) {
    assert.deepEqual(
      [i.deadline, i.responsibleUserId, i.risk, i.evidence, i.justification, i.cnoNumber, i.applicabilityConfirmed, i.blocksDelivery, i.status],
      [null, null, null, null, null, null, false, false, "PENDENTE"],
      `${i.title}: nada inventado`
    );
  }
});

check("itens específicos da obra podem ser adicionados (checklist configurável por parâmetro)", () => {
  const list = D.buildInitialChecklist((k) => k, [{ key: "X", title: "Licença ambiental de operação", phase: "ENTREGA" }]);
  assert.deepEqual(list.map((i) => i.title), ["Licença ambiental de operação"]);
});

check("situação: pendente / em andamento / concluído / não aplicável; mesma situação é recusada", () => {
  assert.deepEqual(Object.keys(D.DELIVERY_STATUS_LABELS), ["PENDENTE", "EM_ANDAMENTO", "CONCLUIDO", "NAO_APLICAVEL"]);
  assert.throws(() => D.changeStatus(mk(), { to: "PENDENTE", actorCanConclude: true }, "u1", NOW), /já está nesta situação/);
  const r = D.changeStatus(mk(), { to: "EM_ANDAMENTO", actorCanConclude: false }, "u1", NOW);
  assert.equal(r.item.status, "EM_ANDAMENTO");
  assert.equal(r.history.kind, "STATUS");
});

check("NÃO APLICÁVEL exige justificativa e fica no histórico", () => {
  assert.throws(() => D.changeStatus(mk(), { to: "NAO_APLICAVEL", actorCanConclude: true, justification: "  " }, "u1", NOW), /exige justificativa/);
  const r = D.changeStatus(mk(), { to: "NAO_APLICAVEL", actorCanConclude: true, justification: "Fora do escopo contratual (cláusula 4.1)" }, "u1", NOW);
  assert.equal(r.item.status, "NAO_APLICAVEL");
  assert.equal(r.item.justification, "Fora do escopo contratual (cláusula 4.1)");
  assert.match(r.history.detail, /Pendente → Não aplicável: Fora do escopo/);
  assert.equal(r.history.actorUserId, "u1");
});

check("CONCLUÍDO exige usuário autorizado E evidência ou justificativa", () => {
  assert.throws(() => D.changeStatus(mk(), { to: "CONCLUIDO", actorCanConclude: false, evidence: "Protocolo 123" }, "u1", NOW), /usuário autorizado/);
  assert.throws(() => D.changeStatus(mk(), { to: "CONCLUIDO", actorCanConclude: true }, "u1", NOW), /evidência.*ou uma justificativa/);
  const ok1 = D.changeStatus(mk(), { to: "CONCLUIDO", actorCanConclude: true, evidence: "Protocolo 123/2027" }, "u1", NOW);
  assert.equal(ok1.item.status, "CONCLUIDO");
  assert.equal(ok1.item.evidence, "Protocolo 123/2027");
  const ok2 = D.changeStatus(mk(), { to: "CONCLUIDO", actorCanConclude: true, justification: "Entregue em mãos ao cliente, ata anexa ao e-mail" }, "u1", NOW);
  assert.equal(ok2.item.status, "CONCLUIDO");
  const withExisting = D.changeStatus(mk({ evidence: "Documento já registrado" }), { to: "CONCLUIDO", actorCanConclude: true }, "u1", NOW);
  assert.equal(withExisting.item.status, "CONCLUIDO");
});

check("upload/registro de evidência SOZINHO nunca conclui", () => {
  const r = D.attachEvidence(mk({ status: "EM_ANDAMENTO" }), "Databook_v3.pdf", "u1", NOW);
  assert.equal(r.item.status, "EM_ANDAMENTO");
  assert.equal(r.item.evidence, "Databook_v3.pdf");
  assert.equal(r.history.kind, "EVIDENCE");
  assert.match(r.history.detail, /situação não foi alterada/);
  assert.throws(() => D.attachEvidence(mk(), " ", "u1", NOW), /Informe a evidência/);
});

check("responsável interno: só colaborador ATIVO da obra; dependência externa mantém o responsável interno", () => {
  const active = new Set(["u-ana", "u-bruno"]);
  assert.equal(D.assignResponsible(mk(), "u-ana", active).responsibleUserId, "u-ana");
  assert.throws(() => D.assignResponsible(mk(), "u-fora", active), /colaborador ativo/);
  const dep = D.setDependency(D.assignResponsible(mk(), "u-ana", active), "CONCESSIONARIA", "Concessionária de água");
  assert.equal(dep.responsibleUserId, "u-ana", "responsável interno preservado");
  assert.equal(dep.dependencyKind, "CONCESSIONARIA");
  assert.throws(() => D.setDependency(mk(), "CLIENTE", " "), /parte externa/);
  assert.equal(D.setDependency(dep, null, null).dependencyKind, null);
});

check("destaques: sem responsável, sem prazo, próximo do vencimento, vencido, concluído, bloqueia entrega", () => {
  const today = "2027-06-01";
  const f = (over) => D.deliveryFlags(mk(over), today);
  assert.deepEqual(f({}).filter((x) => ["SEM_RESPONSAVEL", "SEM_PRAZO"].includes(x)), ["SEM_RESPONSAVEL", "SEM_PRAZO"]);
  assert.ok(f({ responsibleUserId: "u", deadline: "2027-06-05" }).includes("PROXIMO_VENCIMENTO"));
  assert.ok(f({ responsibleUserId: "u", deadline: "2027-06-08" }).includes("PROXIMO_VENCIMENTO"));
  assert.ok(!f({ responsibleUserId: "u", deadline: "2027-06-09" }).includes("PROXIMO_VENCIMENTO"));
  assert.ok(f({ responsibleUserId: "u", deadline: "2027-05-31" }).includes("VENCIDO"));
  assert.ok(!f({ responsibleUserId: "u", deadline: "2027-06-01" }).includes("VENCIDO"), "vence hoje ainda não está vencido");
  assert.ok(f({ blocksDelivery: true }).includes("BLOQUEIA_ENTREGA"));
  assert.ok(f({}).includes("APLICABILIDADE_A_CONFIRMAR") && f({}).includes("RISCO_A_DEFINIR"));
  assert.deepEqual(f({ status: "CONCLUIDO", deadline: "2027-01-01" }), ["CONCLUIDO"], "concluído não é marcado como vencido");
  assert.deepEqual(f({ status: "NAO_APLICAVEL" }), ["NAO_APLICAVEL"]);
});

// ---------- marco de 60 dias ----------

check("D−60: antes, no dia e depois da janela (término 2027-08-15 → janela abre em 2027-06-16)", () => {
  const item = mk({ deadline: null });
  assert.equal(D.addDays(END, -60), "2027-06-16");
  const s = (today) => D.deliveryAlertSchedule(item, END, today);
  assert.equal(s("2027-06-15").state, "AGUARDANDO_JANELA");
  assert.equal(s("2027-06-15").alertStart, "2027-06-16");
  assert.equal(s("2027-06-16").state, "ALERTA");
  assert.equal(s("2027-06-16").basis, "D_MENOS_60");
  assert.equal(s("2027-07-30").state, "ALERTA");
  assert.equal(s("2027-08-15").state, "ALERTA", "no dia do término ainda não está vencido");
  assert.equal(s("2027-08-16").state, "VENCIDO");
  assert.equal(s("2028-01-01").state, "VENCIDO", "permanece vencida até conclusão/dispensa");
});

check("ativação DENTRO da janela: item novo/reaberto é devido na próxima execução (cálculo sem estado)", () => {
  const today = "2027-07-20";
  const due = D.selectDueDeliveryAlerts([mk({ id: "novo" })], END, today);
  assert.equal(due.length, 1);
  assert.equal(due[0].schedule.state, "ALERTA");
});

check("prazo individual ANTERIOR à janela gera o alerta pelo vencimento, sem aguardar D−60", () => {
  const item = mk({ deadline: "2027-04-30" });
  const before = D.deliveryAlertSchedule(item, END, "2027-04-29");
  assert.equal(before.state, "AGUARDANDO_JANELA");
  assert.equal(before.basis, "PRAZO_INDIVIDUAL");
  assert.equal(before.alertStart, "2027-04-30");
  assert.equal(D.deliveryAlertSchedule(item, END, "2027-04-30").state, "ALERTA");
  assert.equal(D.deliveryAlertSchedule(item, END, "2027-05-01").state, "VENCIDO");
  // Prazo individual DEPOIS de D−60: vale a janela.
  const later = D.deliveryAlertSchedule(mk({ deadline: "2027-08-01" }), END, "2027-06-20");
  assert.equal(later.basis, "D_MENOS_60");
  assert.equal(later.state, "ALERTA");
});

check("sem data final da obra: não calcula D−60 (pede o preenchimento); prazo individual continua valendo", () => {
  const s = D.deliveryAlertSchedule(mk(), null, "2027-06-01");
  assert.equal(s.state, "SEM_DATA_FINAL");
  assert.match(s.message, /data final da obra/);
  assert.equal(s.alertStart, null);
  const withDeadline = D.deliveryAlertSchedule(mk({ deadline: "2027-06-10" }), null, "2027-06-10");
  assert.equal(withDeadline.state, "ALERTA");
  assert.equal(withDeadline.basis, "PRAZO_INDIVIDUAL");
  assert.equal(D.selectDueDeliveryAlerts([mk()], null, "2027-06-01").length, 0);
});

check("concluídos, não aplicáveis e itens de INÍCIO não entram na janela D−60", () => {
  for (const status of ["CONCLUIDO", "NAO_APLICAVEL"]) assert.equal(D.deliveryAlertSchedule(mk({ status }), END, "2027-07-20").state, "NAO_APLICAVEL_AO_ALERTA");
  const cno = D.buildInitialChecklist((k) => k).find((i) => i.checklistKey === "CNO");
  assert.equal(D.deliveryAlertSchedule(cno, END, "2027-07-20").state, "NAO_APLICAVEL_AO_ALERTA");
  assert.equal(D.selectDueDeliveryAlerts([mk({ status: "CONCLUIDO" }), mk({ status: "NAO_APLICAVEL" })], END, "2027-07-20").length, 0);
});

check("grau de risco: o escolhido por item (1/2/4/7 dias); sem escolha usa MÉDIO e sinaliza — nunca crítico por padrão", () => {
  const items = [mk({ id: "a", risk: "ALTA" }), mk({ id: "b" }), mk({ id: "c", risk: "BAIXA" })];
  const due = D.selectDueDeliveryAlerts(items, END, "2027-07-20");
  assert.deepEqual(due.map((d) => [d.item.id, d.severity, d.riskDefaulted]), [["a", "ALTA", false], ["b", "MEDIA", true], ["c", "BAIXA", false]]);
  assert.ok(!due.some((d) => d.severity === "CRITICA"));
});

check("mudança do término recalcula marcos futuros e preserva atrasos e histórico", () => {
  const today = "2027-06-20";
  const items = [mk({ id: "dentro" }), mk({ id: "atrasado", deadline: "2027-05-01" })];
  const r = D.recalculateAfterEndDateChange(items, END, "2027-12-15", today, "u1", NOW);
  const by = Object.fromEntries(r.schedules.map((s) => [s.itemId, s]));
  assert.equal(by.dentro.before.state, "ALERTA");
  assert.equal(by.dentro.after.state, "AGUARDANDO_JANELA", "término mais tarde adia o marco futuro");
  assert.equal(by.dentro.after.alertStart, "2027-10-16");
  assert.equal(by.atrasado.before.state, "VENCIDO");
  assert.equal(by.atrasado.after.state, "VENCIDO", "atraso já registrado não é apagado");
  assert.equal(r.history.kind, "END_DATE_CHANGED");
  assert.match(r.history.detail, /2027-08-15 → 2027-12-15.*atrasos registrados preservados/);
  const cleared = D.recalculateAfterEndDateChange(items, END, null, today, "u1", NOW);
  assert.equal(cleared.schedules[0].after.state, "SEM_DATA_FINAL");
});

// ---------- CNO ----------

check("CNO: item de INÍCIO, prazo = início da obra + 30 dias (configurável), definitivo só com início confirmado", () => {
  const est = D.computeCnoDeadline({ constructionStartDay: "2026-10-19", startConfirmed: false });
  assert.equal(est.deadline, "2026-11-18");
  assert.equal(est.definitive, false);
  assert.match(est.basis, /^ESTIMADO/);
  const def = D.computeCnoDeadline({ constructionStartDay: "2026-10-23", startConfirmed: true });
  assert.equal(def.deadline, "2026-11-22");
  assert.equal(def.definitive, true);
  assert.equal(D.computeCnoDeadline({ constructionStartDay: "2026-10-23", startConfirmed: true, deadlineDays: 15 }).deadline, "2026-11-07");
  assert.equal(D.CNO_DEFAULT_DEADLINE_DAYS, 30);
});

check("CNO: prazo interno antecipado prevalece sobre o legal; sem data de início não calcula e não é definitivo", () => {
  const r = D.computeCnoDeadline({ constructionStartDay: "2026-10-23", startConfirmed: true, internalDeadline: "2026-11-10" });
  assert.equal(r.deadline, "2026-11-10");
  const none = D.computeCnoDeadline({ constructionStartDay: null, startConfirmed: false });
  assert.equal(none.deadline, null);
  assert.equal(none.definitive, false);
  assert.match(none.basis, /não calculado/);
});

check("CNO: início DIVERGENTE (cadastro 19/10 × histórico 23/10) NÃO gera prazo definitivo nem escolhe uma data; só o prazo interno, se houver", () => {
  const r = D.computeCnoDeadline({ constructionStartDay: "2026-10-19", startConfirmed: false, startCandidates: ["2026-10-19", "2026-10-23"] });
  assert.equal(r.deadline, null);
  assert.equal(r.definitive, false);
  assert.equal(r.divergent, true);
  assert.match(r.basis, /DIVERGENTE \(2026-10-19 × 2026-10-23\).*NÃO calculado/);
  const withInternal = D.computeCnoDeadline({ constructionStartDay: "2026-10-19", startConfirmed: false, startCandidates: ["2026-10-19", "2026-10-23"], internalDeadline: "2026-11-05" });
  assert.equal(withInternal.deadline, "2026-11-05", "prazo interno configurável continua valendo");
  assert.equal(withInternal.definitive, false);
  const same = D.computeCnoDeadline({ constructionStartDay: "2026-10-19", startConfirmed: true, startCandidates: ["2026-10-19", "2026-10-19"] });
  assert.equal(same.divergent, false);
  assert.equal(same.deadline, "2026-11-18");
  assert.match(D.CNO_OFFICIAL_SOURCE_URL, /gov\.br\/receitafederal.*\/cno\/cno$/);
});

check("CNO: confere inscrição existente antes de propor nova", () => {
  assert.equal(D.shouldProposeCnoRegistration({ status: "PENDENTE", cnoNumber: null, evidence: null }), true);
  assert.equal(D.shouldProposeCnoRegistration({ status: "PENDENTE", cnoNumber: "90.123.45678/70", evidence: null }), false);
  assert.equal(D.shouldProposeCnoRegistration({ status: "CONCLUIDO", cnoNumber: null, evidence: "comprovante" }), false);
  assert.equal(D.shouldProposeCnoRegistration({ status: "NAO_APLICAVEL", cnoNumber: null, evidence: null }), false);
});

check("CNO: alerta de ausência de responsável, proximidade e atraso — sem esperar a janela de 60 dias", () => {
  const cno = D.buildInitialChecklist((k) => k).find((i) => i.checklistKey === "CNO");
  assert.deepEqual(D.cnoAlertReasons(cno, "2026-11-01"), ["SEM_RESPONSAVEL"]);
  assert.deepEqual(D.cnoAlertReasons({ ...cno, responsibleUserId: "u", deadline: "2026-11-05" }, "2026-11-01"), ["PROXIMO_PRAZO"]);
  assert.deepEqual(D.cnoAlertReasons({ ...cno, responsibleUserId: "u", deadline: "2026-10-30" }, "2026-11-01"), ["ATRASADO"]);
  assert.deepEqual(D.cnoAlertReasons({ ...cno, responsibleUserId: "u", deadline: "2026-12-30" }, "2026-11-01"), []);
  assert.deepEqual(D.cnoAlertReasons({ ...cno, status: "CONCLUIDO" }, "2026-11-01"), []);
});

check("datas: dias corridos e UTC (sem deslocamento de fuso/horário de verão)", () => {
  assert.equal(D.addDays("2027-03-01", -1), "2027-02-28");
  assert.equal(D.addDays("2028-03-01", -1), "2028-02-29");
  assert.equal(D.daysBetween("2027-01-01", "2027-12-31"), 364);
  assert.throws(() => D.parseDay("01/02/2027"), /Data inválida/);
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
