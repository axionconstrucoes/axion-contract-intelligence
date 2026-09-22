// Composição automática do lote semanal de alertas MÉDIO/BAIXO — sem
// seleção manual (requisito principal desta rodada). Mesma convenção do
// resto do repositório: execução real das funções puras
// (contract-alert-batch-weekly-eligibility.ts,
// get-contract-alert-batches-list.ts) + asserts estruturais sobre o
// código-fonte para tudo que depende de banco/rede (migration, cron,
// job de envio) — nenhum mock de Supabase, @axion/db/googleapis não
// instalados neste ambiente (limitação conhecida, ver
// test-contract-alert-batch.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { planWeeklyContractAlertBatches, isEventEligibleForWeeklyAutoBatch } = await import(
  "../apps/web/lib/email/contract-alert-batch-weekly-eligibility.ts"
);
const { computeContractAlertBatchListStatus } = await import(
  "../apps/web/lib/email/contract-alert-batch-list-status.ts"
);
const { resolveContractAlertBatchWeeklyWindow } = await import(
  "../apps/web/lib/email/contract-alert-batch-weekly-window.ts"
);
const { decideContractAlertBatchRespondOutcome } = await import(
  "../apps/web/lib/email-actions/contract-alert-batch-validation.ts"
);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`OK ${name}`);
}

function readSource(path) {
  return readFileSync(path, "utf8");
}

function event(eventId, projectId, severity, status = "NOVO", occurredAt = "2026-09-15T10:00:00.000Z", title = `Evento ${eventId}`) {
  return { eventId, projectId, occurredAt, title, status, severity };
}

const RECIPIENT_P1 = { projectId: "p1", userId: "user-1", email: "user1@axion.com.br", name: "Responsável Um" };
const RECIPIENT_P2 = { projectId: "p2", userId: "user-2", email: "user2@axion.com.br", name: "Responsável Dois" };

const CUTOFF_DATE = "2026-09-16"; // quarta-feira

// ------------------------------------------------------------------
// A. 2 eventos BAIXO + 1 MÉDIO elegíveis -> 1 lote semanal com 3 itens
// ------------------------------------------------------------------
check("A. 2 BAIXO + 1 MEDIO elegíveis -> 1 lote semanal com os 3 itens (MEDIA antes de BAIXA)", () => {
  const events = [event("a", "p1", "BAIXA"), event("b", "p1", "BAIXA"), event("c", "p1", "MEDIA")];
  const plans = planWeeklyContractAlertBatches({
    events,
    alreadyBatchedEventIds: new Set(),
    recipientsByProject: new Map([["p1", [RECIPIENT_P1]]]),
    cutoffDate: CUTOFF_DATE,
  });
  assert.equal(plans.length, 1, "deveria compor exatamente 1 lote (1 destinatário, 1 projeto)");
  assert.equal(plans[0].items.length, 3);
  assert.equal(plans[0].items[0].eventId, "c", "MEDIA vem antes de BAIXA (ordenação determinística)");
  assert.deepEqual(new Set(plans[0].items.map((i) => i.eventId)), new Set(["a", "b", "c"]));
});

// ------------------------------------------------------------------
// B. CRÍTICO/ALTO no mesmo projeto -> NÃO entra no lote semanal
// ------------------------------------------------------------------
check("B. CRÍTICO e ALTO existentes no mesmo projeto -> não entram no lote semanal", () => {
  assert.equal(isEventEligibleForWeeklyAutoBatch({ status: "NOVO", severity: "CRITICA" }), false);
  assert.equal(isEventEligibleForWeeklyAutoBatch({ status: "NOVO", severity: "ALTA" }), false);

  const events = [event("crit", "p1", "CRITICA"), event("alta", "p1", "ALTA"), event("baixa", "p1", "BAIXA")];
  const plans = planWeeklyContractAlertBatches({
    events,
    alreadyBatchedEventIds: new Set(),
    recipientsByProject: new Map([["p1", [RECIPIENT_P1]]]),
    cutoffDate: CUTOFF_DATE,
  });
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].items.map((i) => i.eventId), ["baixa"], "somente o evento BAIXA deveria entrar");
});

// ------------------------------------------------------------------
// C. mesmo job executado duas vezes -> não duplica lote nem itens
// ------------------------------------------------------------------
check("C. idempotência é uma CONSTRAINT DE BANCO (não apenas uma checagem de aplicação) — nunca corrida entre 2 execuções", () => {
  const migration = readSource("supabase/migrations/20260922090000_contract_alert_batches_weekly_auto.sql");
  assert(
    migration.includes(
      "create unique index contract_alert_batches_weekly_auto_idempotency_idx\n  on public.contract_alert_batches (project_id, recipient_user_id, cutoff_date)\n  where batch_kind = 'WEEKLY_AUTO';"
    ),
    "índice único parcial (project_id, recipient_user_id, cutoff_date) para batch_kind = WEEKLY_AUTO deveria existir"
  );
  assert(!/alter\s+table\s+public\.contract_alert_batches\s+drop/i.test(migration), "migration é puramente aditiva — nunca remove/altera coluna existente");
  assert(!/create\s+or\s+replace\s+function\s+public\.submit_contract_alert_batch_response/i.test(migration), "não deveria tocar na RPC já aplicada em produção");

  const runner = readSource("apps/web/lib/email/run-weekly-contract-alert-batches.ts");
  assert(
    /createError\.code === "23505"/.test(runner) && /skippedAlreadyExists/.test(runner),
    "o job deveria tratar violação de unicidade (23505) como 'já existe, ignorar' — nunca 'verifica-depois-insere' com janela de corrida"
  );
  assert(
    !/\.maybeSingle\(\)[\s\S]{0,200}if\s*\(!existing\)/.test(runner),
    "não deveria usar o padrão 'verifica se existe, senão insere' (janela de corrida entre execuções concorrentes)"
  );
});

// ------------------------------------------------------------------
// D. evento já RESOLVIDO -> não entra
// ------------------------------------------------------------------
check("D. evento já RESOLVIDO -> não entra no lote semanal mesmo com severidade BAIXA/MEDIA", () => {
  assert.equal(isEventEligibleForWeeklyAutoBatch({ status: "RESOLVIDO", severity: "BAIXA" }), false);
  assert.equal(isEventEligibleForWeeklyAutoBatch({ status: "RESOLVIDO", severity: "MEDIA" }), false);

  const events = [event("resolvido", "p1", "MEDIA", "RESOLVIDO"), event("ativo", "p1", "MEDIA", "EM_ANALISE")];
  const plans = planWeeklyContractAlertBatches({
    events,
    alreadyBatchedEventIds: new Set(),
    recipientsByProject: new Map([["p1", [RECIPIENT_P1]]]),
    cutoffDate: CUTOFF_DATE,
  });
  assert.deepEqual(plans[0].items.map((i) => i.eventId), ["ativo"]);
});

// ------------------------------------------------------------------
// E. evento criado depois do fechamento do lote atual -> entra somente
// no próximo lote semanal (nunca altera silenciosamente um lote já
// enviado)
// ------------------------------------------------------------------
check("E. evento surgido depois do fechamento -> não altera o lote já composto; só aparece na composição seguinte", () => {
  // "Fechamento" = o momento em que o job lê os eventos elegíveis e
  // grava o lote — um evento que só passa a existir DEPOIS desse
  // instante simplesmente não está na lista `events` desta execução;
  // ele entra naturalmente na próxima execução (próxima semana), pela
  // MESMA função, sem qualquer código especial de "adicionar depois".
  const semana1 = planWeeklyContractAlertBatches({
    events: [event("evt-1", "p1", "BAIXA")],
    alreadyBatchedEventIds: new Set(),
    recipientsByProject: new Map([["p1", [RECIPIENT_P1]]]),
    cutoffDate: "2026-09-16",
  });
  assert.deepEqual(semana1[0].items.map((i) => i.eventId), ["evt-1"]);

  // "evt-2" só passou a existir depois — simulado por só aparecer na
  // lista de eventos da semana seguinte. evt-1 já foi tratado
  // (alreadyBatchedEventIds), então o lote já enviado nunca é
  // silenciosamente alterado — evt-2 abre um lote NOVO, não um item
  // extra no de evt-1.
  const semana2 = planWeeklyContractAlertBatches({
    events: [event("evt-1", "p1", "BAIXA"), event("evt-2", "p1", "BAIXA")],
    alreadyBatchedEventIds: new Set(["evt-1"]),
    recipientsByProject: new Map([["p1", [RECIPIENT_P1]]]),
    cutoffDate: "2026-09-23",
  });
  assert.deepEqual(semana2[0].items.map((i) => i.eventId), ["evt-2"]);
  assert.equal(semana2[0].cutoffDate, "2026-09-23", "novo lote pertence ao fechamento em que evt-2 foi visto, nunca retroage ao fechamento anterior");
});

// ------------------------------------------------------------------
// F. projetos diferentes -> lotes separados (nunca mistura)
// ------------------------------------------------------------------
check("F. projetos diferentes -> lotes SEPARADOS, nunca um lote misturando dois projetos", () => {
  const events = [event("a", "p1", "BAIXA"), event("b", "p2", "MEDIA")];
  const plans = planWeeklyContractAlertBatches({
    events,
    alreadyBatchedEventIds: new Set(),
    recipientsByProject: new Map([
      ["p1", [RECIPIENT_P1]],
      ["p2", [RECIPIENT_P2]],
    ]),
    cutoffDate: CUTOFF_DATE,
  });
  assert.equal(plans.length, 2);
  const byProject = new Map(plans.map((p) => [p.projectId, p]));
  assert.deepEqual(byProject.get("p1").items.map((i) => i.eventId), ["a"]);
  assert.deepEqual(byProject.get("p2").items.map((i) => i.eventId), ["b"]);
  assert.notEqual(byProject.get("p1").recipientUserId, byProject.get("p2").recipientUserId);
});

check("projeto sem destinatário resolvido -> nenhum lote inventado (nunca um destinatário arbitrário/genérico)", () => {
  // Cobre o gap atual: resolveWeeklyContractAlertBatchRecipients devolve
  // Map vazio até haver uma fonte de responsável aprovada (ver run-
  // weekly-contract-alert-batches.ts) — a função pura precisa continuar
  // não inventando nada nesse caso, nunca um "destinatário padrão".
  const plans = planWeeklyContractAlertBatches({
    events: [event("a", "p3", "BAIXA")],
    alreadyBatchedEventIds: new Set(),
    recipientsByProject: new Map(),
    cutoffDate: CUTOFF_DATE,
  });
  assert.equal(plans.length, 0);
});

// ------------------------------------------------------------------
// G/H. mesmo gate de resposta (decideContractAlertBatchRespondOutcome)
// vale IGUAL para lotes WEEKLY_AUTO — nunca uma segunda regra de
// bloqueio para o caminho automático.
// ------------------------------------------------------------------
check("G. 2 de 3 respondidos -> RESPONDER AO ACC bloqueado (mesmo gate do lote manual, batch_kind é irrelevante para a decisão)", () => {
  const outcome = decideContractAlertBatchRespondOutcome({
    batchStatus: "SENT",
    items: [
      { eventId: "a", title: "A", action: null, assignedUserId: null },
      { eventId: "b", title: "B", action: null, assignedUserId: null },
      { eventId: "c", title: "C", action: null, assignedUserId: null },
    ],
    responses: [
      { eventId: "a", action: "RESOLVIDO" },
      { eventId: "b", action: "EM_ANDAMENTO" },
    ],
    activeProjectMemberUserIds: new Set(["colaborador-valido"]),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 422);
});

check("H. 3 de 3 respondidos -> RESPONDER AO ACC liberado", () => {
  const outcome = decideContractAlertBatchRespondOutcome({
    batchStatus: "SENT",
    items: [
      { eventId: "a", title: "A", action: null, assignedUserId: null },
      { eventId: "b", title: "B", action: null, assignedUserId: null },
      { eventId: "c", title: "C", action: null, assignedUserId: null },
    ],
    responses: [
      { eventId: "a", action: "RESOLVIDO" },
      { eventId: "b", action: "EM_ANDAMENTO" },
      { eventId: "c", action: "ENVIADO_PARA", assignedUserId: "colaborador-valido" },
    ],
    activeProjectMemberUserIds: new Set(["colaborador-valido"]),
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.status, 200);
});

// ------------------------------------------------------------------
// Listagem: status ABERTO/RESPONDIDO exibido corretamente — SEM PARCIAL
// (a RPC de resposta é atômica; um SENT parcialmente respondido nunca é
// um estado real persistido, então nunca é exibido como se fosse).
// ------------------------------------------------------------------
check("listagem: status calculado a partir de dados reais — nunca um PARCIAL inalcançável", () => {
  assert.equal(computeContractAlertBatchListStatus({ status: "PENDING", answeredCount: 0, totalCount: 3 }), "PENDENTE_ENVIO");
  assert.equal(computeContractAlertBatchListStatus({ status: "SENT", answeredCount: 0, totalCount: 3 }), "ABERTO");
  // Mesmo que answeredCount venha "no meio" por algum motivo (dado real,
  // nunca assumido), a listagem não inventa uma categoria PARCIAL que a
  // RPC atômica não sustenta — continua ABERTO.
  assert.equal(computeContractAlertBatchListStatus({ status: "SENT", answeredCount: 2, totalCount: 3 }), "ABERTO");
  assert.equal(computeContractAlertBatchListStatus({ status: "RESPONDED", answeredCount: 3, totalCount: 3 }), "RESPONDIDO");
  assert.equal(computeContractAlertBatchListStatus({ status: "FAILED", answeredCount: 0, totalCount: 3 }), "FALHOU");
});

check("PARCIAL não existe como valor possível de status (estado inalcançável nunca é exibido)", () => {
  const statusModule = readSource("apps/web/lib/email/contract-alert-batch-list-status.ts");
  const typeLine = statusModule.match(/export type ContractAlertBatchListStatus = [^;]+;/)?.[0] ?? "";
  assert(typeLine, "deveria encontrar a declaração do tipo ContractAlertBatchListStatus");
  assert(!/PARCIAL/.test(typeLine), "PARCIAL não deveria ser um valor possível de ContractAlertBatchListStatus");

  const page = readSource("apps/web/app/[projectId]/ledger/lote-alertas/page.tsx");
  const labelsBlock = page.match(/LIST_STATUS_LABELS[\s\S]*?\n};/)?.[0] ?? "";
  const variantsBlock = page.match(/LIST_STATUS_VARIANTS[\s\S]*?\n};/)?.[0] ?? "";
  assert(labelsBlock && variantsBlock, "deveria encontrar os mapas de rótulo/estilo da listagem");
  assert(!/PARCIAL/.test(labelsBlock) && !/PARCIAL/.test(variantsBlock), "a listagem não deveria mapear um status PARCIAL");
});

// ------------------------------------------------------------------
// Estrutura: sidebar, listagem, cron, item "VER EVENTO" no formulário
// ------------------------------------------------------------------
check("nav-items.ts: 'Lotes de Alertas' existe como item próprio (sidebar atual não tem submenu)", () => {
  const navItems = readSource("apps/web/lib/ui/nav-items.ts");
  assert(navItems.includes('href: "ledger/lote-alertas"') && navItems.includes('label: "Lotes de Alertas"'));
  const featureHelp = readSource("apps/web/lib/ui/feature-help.ts");
  assert(featureHelp.includes('id: "lotes-de-alertas"'));
});

check("app-sidebar.tsx: item ativo usa o href MAIS ESPECÍFICO — 'Event Ledger' e 'Lotes de Alertas' nunca acendem juntos", () => {
  const sidebar = readSource("apps/web/components/layout/app-sidebar.tsx");
  assert(sidebar.includes("href.length > best.length"), "resolução do item mais específico deveria continuar presente");
  assert(sidebar.includes("const active = href === activeHref;"));
});

check("página de listagem (/lote-alertas) mostra fechamento, destinatário, quantidade, baixo/médio, respondidos, status e data de envio", () => {
  const page = readSource("apps/web/app/[projectId]/ledger/lote-alertas/page.tsx");
  for (const needle of [
    "getContractAlertBatchesList",
    "formatCutoffLabel",
    "recipientName",
    "totalCount",
    "lowCount",
    "mediumCount",
    "answeredCount",
    "listStatus",
    "sentAt",
  ]) {
    assert(page.includes(needle), `listagem deveria referenciar "${needle}"`);
  }
});

check("contract-alert-batch-form.tsx: cada item tem 'VER EVENTO' apontando para a tela real do evento (/{projectId}/ledger/{eventId})", () => {
  const form = readSource("apps/web/app/[projectId]/ledger/lote-alertas/[batchId]/contract-alert-batch-form.tsx");
  assert(form.includes("CONTRACT_ALERT_BATCH_VIEW_EVENT_LABEL"));
  assert(form.includes("href={`/${projectId}/ledger/${item.eventId}`}"));
  assert(form.includes('target="_blank"'), "abre em nova aba — nunca perde o progresso do formulário do lote");
});

check("cron: rota dedicada com o MESMO mecanismo de autorização (CRON_SECRET) do resumo semanal já existente — nenhum scheduler paralelo", () => {
  const route = readSource("apps/web/app/api/cron/contract-alert-batches-weekly/route.ts");
  assert(route.includes("isCronRequestAuthorized"));
  assert(route.includes("process.env.CRON_SECRET"));
  const vercelJson = readSource("apps/web/vercel.json");
  assert(vercelJson.includes("/api/cron/contract-alert-batches-weekly"));
});

check("cron semanal executa na quarta-feira às 08:00 (regra definitiva aprovada — nunca segunda-feira)", () => {
  const vercel = JSON.parse(readSource("apps/web/vercel.json"));
  const entry = vercel.crons.find((c) => c.path === "/api/cron/contract-alert-batches-weekly");
  assert(entry, "entrada do cron deveria existir em vercel.json");
  // "0 11 * * 3" = quarta-feira 11:00 UTC = quarta-feira 08:00 America/Sao_Paulo
  // (UTC-3 fixo — Brasil sem horário de verão desde 2019), mesma
  // convenção já usada pelo cron do resumo semanal existente
  // ("0 10 * * 3" = quarta 07:00 local).
  assert.equal(entry.schedule, "0 11 * * 3");
});

check("job semanal reaproveita o mecanismo ICU (Intl) do resumo semanal existente (toLocalDateParts) para a janela quarta-feira 08:00 — nunca um scheduler paralelo nem offset fixo", () => {
  const runner = readSource("apps/web/lib/email/run-weekly-contract-alert-batches.ts");
  assert(runner.includes('from "./contract-alert-batch-weekly-window"'));
  assert(runner.includes("resolveContractAlertBatchWeeklyWindow("));

  const window = readSource("apps/web/lib/email/contract-alert-batch-weekly-window.ts");
  assert(window.includes('from "../risk-alerts/digest-window"'), "deveria reaproveitar toLocalDateParts do mecanismo já existente, nunca reimplementar cálculo de fuso");
  assert(window.includes("toLocalDateParts("));
  assert(/CUTOFF_WEEKDAY\s*=\s*3/.test(window), "quarta-feira (0 = domingo)");
  assert(/CUTOFF_HOUR_LOCAL\s*=\s*8/.test(window), "08:00 local — regra definitiva aprovada");
});

check("resolveContractAlertBatchWeeklyWindow: fechamento é exatamente quarta-feira 08:00 America/Sao_Paulo (DST-safe via Intl, nunca offset fixo)", () => {
  // UTC-3 fixo hoje (Brasil sem horário de verão desde 2019), mas o
  // cálculo usa Intl (toLocalDateParts) — nunca um offset hardcoded —
  // então continua correto se o horário de verão for reintroduzido.
  assert.equal(
    resolveContractAlertBatchWeeklyWindow("2026-09-16T10:55:00Z", "America/Sao_Paulo").isOpen,
    false,
    "quarta 07:55 local ainda não é o fechamento"
  );
  const atCutoff = resolveContractAlertBatchWeeklyWindow("2026-09-16T11:00:00Z", "America/Sao_Paulo");
  assert.equal(atCutoff.isOpen, true, "quarta 08:00 local é exatamente o fechamento");
  assert.equal(atCutoff.cutoffDate, "2026-09-16");

  const nextWeek = resolveContractAlertBatchWeeklyWindow("2026-09-17T12:00:00Z", "America/Sao_Paulo");
  assert.equal(nextWeek.isOpen, false);
  assert.equal(nextWeek.cutoffDate, "2026-09-23", "quinta-feira em diante aponta para o PRÓXIMO fechamento, nunca retroage");
});

check("destinatário do lote automático vem de uma fonte real aprovada, nunca de uma regra genérica de ADMINISTRADOR (gap conhecido, documentado, não implementado sem aprovação)", () => {
  const runner = readSource("apps/web/lib/email/run-weekly-contract-alert-batches.ts");
  assert(
    !/\.eq\(\s*["']permission["']\s*,\s*["']ADMINISTRADOR["']\s*\)/.test(runner),
    "não deveria mais filtrar project_memberships por permission = ADMINISTRADOR — suposição não aprovada da rodada anterior"
  );
  assert(runner.includes("resolveWeeklyContractAlertBatchRecipients"), "resolução de destinatário deveria estar isolada numa função própria (fácil de substituir quando a fonte real for aprovada)");
  assert(runner.includes("GAP CONHECIDO"), "o gap de arquitetura (sem responsável inequívoco para contract_events) deveria estar documentado no código, não silenciosamente contornado");
});

check("guard de piloto/pilot-outbound-guard.ts continua intocado — envio automático usa resolveEffectiveRecipient, nunca uma segunda decisão de destinatário", () => {
  const sender = readSource("apps/web/lib/email/send-contract-alert-batch-email.ts");
  assert(sender.includes('from "./pilot-outbound-guard"'));
  assert(sender.includes("resolveEffectiveRecipient("));
  assert(!/ACC_PILOT_INSTITUTIONAL_MAILBOXES|ACC_EXPECTED_PILOT_RECIPIENT\s*=/.test(sender), "não deveria redefinir/hardcodar nada do guard institucional");
});

console.log(`\n${passed} verificações concluídas.`);
