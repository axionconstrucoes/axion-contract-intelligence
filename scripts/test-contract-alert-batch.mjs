// Testes do lote de alertas de contrato (múltiplos alertas por e-mail +
// bloqueio de "RESPONDER AO ACC" até todos os eventos terem uma ação
// válida). Mesma convenção do resto do repositório: execução real das
// funções puras (contract-alert-batch-validation.ts,
// contract-alert-batch-template.ts) + asserts estruturais sobre o
// código-fonte para tudo que depende de banco (o mesmo padrão de
// test-weekly-alert-digest.mjs) — nenhum mock de Supabase, porque
// @axion/db/@supabase/supabase-js não estão instalados neste ambiente
// (limitação conhecida, documentada em vários outros test-*.mjs deste
// repositório).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const {
  resolveContractAlertBatchAnsweredState,
  decideContractAlertBatchRespondOutcome,
  isValidContractAlertBatchAction,
} = await import("../apps/web/lib/email-actions/contract-alert-batch-validation.ts");

const { CONTRACT_ALERT_BATCH_ITEM_ACTIONS, CONTRACT_ALERT_BATCH_ITEM_ACTION_LABELS } = await import(
  "../apps/web/lib/email-actions/contract-alert-batch-types.ts"
);

const { buildContractAlertBatchEmail } = await import(
  "../apps/web/lib/email/templates/contract-alert-batch-template.ts"
);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`OK ${name}`);
}

function item(eventId, action, assignedUserId = null, title = `Evento ${eventId}`) {
  return { eventId, title, action, assignedUserId };
}

// ------------------------------------------------------------------
// 1. 1 alerta respondido -> reply liberado
// ------------------------------------------------------------------
check("1 alerta respondido -> reply liberado", () => {
  const state = resolveContractAlertBatchAnsweredState([item("1", "RESOLVIDO")]);
  assert.equal(state.allEventsAnswered, true);
  assert.equal(state.answeredCount, 1);
  assert.equal(state.totalCount, 1);
  assert.deepEqual(state.pendingItems, []);

  const outcome = decideContractAlertBatchRespondOutcome({
    batchStatus: "SENT",
    items: [item("1", null)],
    responses: [{ eventId: "1", action: "RESOLVIDO" }],
    activeProjectMemberUserIds: new Set(),
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.status, 200);
  assert.equal(outcome.respondedItems, 1);
});

// ------------------------------------------------------------------
// 2. 2 alertas, 1 respondido -> reply bloqueado
// ------------------------------------------------------------------
check("2 alertas, 1 respondido -> reply bloqueado", () => {
  const state = resolveContractAlertBatchAnsweredState([
    item("1", "RESOLVIDO"),
    item("2", null, null, "Evento pendente 2"),
  ]);
  assert.equal(state.allEventsAnswered, false);
  assert.equal(state.answeredCount, 1);
  assert.equal(state.totalCount, 2);
  assert.deepEqual(state.pendingItems, [{ eventId: "2", title: "Evento pendente 2" }]);

  const outcome = decideContractAlertBatchRespondOutcome({
    batchStatus: "SENT",
    items: [item("1", null), item("2", null, null, "Evento pendente 2")],
    responses: [{ eventId: "1", action: "RESOLVIDO" }],
    activeProjectMemberUserIds: new Set(),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 422);
  assert.equal(outcome.error, "Todos os alertas precisam ter uma ação definida antes do envio.");
});

// ------------------------------------------------------------------
// 3. 3 alertas, todos respondidos -> reply liberado
// ------------------------------------------------------------------
check("3 alertas, todos respondidos -> reply liberado", () => {
  const items = [item("1", null), item("2", null), item("3", null)];
  const responses = [
    { eventId: "1", action: "RESOLVIDO" },
    { eventId: "2", action: "EM_ANDAMENTO" },
    { eventId: "3", action: "ENVIADO_PARA", assignedUserId: "user-x" },
  ];
  const outcome = decideContractAlertBatchRespondOutcome({
    batchStatus: "SENT",
    items,
    responses,
    activeProjectMemberUserIds: new Set(["user-x"]),
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.status, 200);
  assert.equal(outcome.respondedItems, 3);
});

// ------------------------------------------------------------------
// 4. ENVIADO P/ sem colaborador -> bloqueado
// ------------------------------------------------------------------
check("ENVIADO P/ sem colaborador -> bloqueado", () => {
  const state = resolveContractAlertBatchAnsweredState([item("1", "ENVIADO_PARA", null)]);
  assert.equal(state.allEventsAnswered, false);
  assert.deepEqual(state.pendingItems, [{ eventId: "1", title: "Evento 1" }]);

  const outcome = decideContractAlertBatchRespondOutcome({
    batchStatus: "SENT",
    items: [item("1", null)],
    responses: [{ eventId: "1", action: "ENVIADO_PARA" }],
    activeProjectMemberUserIds: new Set(["user-x"]),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 422);
  assert.equal(outcome.error, "Selecione um colaborador ativo do projeto para cada evento enviado.");
});

// ------------------------------------------------------------------
// 5. ENVIADO P/ com colaborador válido -> válido
// ------------------------------------------------------------------
check("ENVIADO P/ com colaborador válido -> válido", () => {
  const state = resolveContractAlertBatchAnsweredState([item("1", "ENVIADO_PARA", "user-x")]);
  assert.equal(state.allEventsAnswered, true);
  assert.equal(state.answeredCount, 1);

  const outcome = decideContractAlertBatchRespondOutcome({
    batchStatus: "SENT",
    items: [item("1", null)],
    responses: [{ eventId: "1", action: "ENVIADO_PARA", assignedUserId: "user-x" }],
    activeProjectMemberUserIds: new Set(["user-x"]),
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.status, 200);

  // colaborador que existe mas não está mais ATIVO no projeto também é
  // recusado — activeProjectMemberUserIds só contém membros ATIVOS.
  const outcomeInactive = decideContractAlertBatchRespondOutcome({
    batchStatus: "SENT",
    items: [item("1", null)],
    responses: [{ eventId: "1", action: "ENVIADO_PARA", assignedUserId: "user-inativo" }],
    activeProjectMemberUserIds: new Set(["user-x"]),
  });
  assert.equal(outcomeInactive.ok, false);
  assert.equal(outcomeInactive.status, 422);
});

// ------------------------------------------------------------------
// 6. VER EVENTO somente -> continua pendente
// ------------------------------------------------------------------
check("VER EVENTO somente -> continua pendente", () => {
  // "VER EVENTO" nunca é um valor de `action` possível — clicar nele
  // apenas navega, nunca preenche `action`.
  assert.equal(isValidContractAlertBatchAction("VER_EVENTO"), false);
  assert.equal(CONTRACT_ALERT_BATCH_ITEM_ACTIONS.includes("VER_EVENTO"), false);

  const state = resolveContractAlertBatchAnsweredState([item("1", null)]);
  assert.equal(state.allEventsAnswered, false);
  assert.equal(state.pendingItems.length, 1);

  const outcome = decideContractAlertBatchRespondOutcome({
    batchStatus: "SENT",
    items: [item("1", null)],
    responses: [],
    activeProjectMemberUserIds: new Set(),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 422);
});

// ------------------------------------------------------------------
// 7. tentativa direta no endpoint com item pendente -> rejeitada
// ------------------------------------------------------------------
// decideContractAlertBatchRespondOutcome é a MESMA função que o endpoint
// real (apps/web/app/api/contract-alert-batches/[batchId]/respond/
// route.ts, via respond-to-contract-alert-batch.ts) chama depois de
// recarregar o lote do banco — chamá-la aqui diretamente, com um lote
// simulado com 2 itens e só 1 resposta, é exatamente o "chamar o
// endpoint diretamente com item pendente" pedido, sem precisar de rede
// nem de banco (que não estão disponíveis neste ambiente).
check("tentativa direta no endpoint com item pendente -> rejeitada", () => {
  const outcome = decideContractAlertBatchRespondOutcome({
    batchStatus: "SENT",
    items: [item("1", null), item("2", null, null, "Evento pendente 2")],
    responses: [{ eventId: "1", action: "RESOLVIDO" }],
    activeProjectMemberUserIds: new Set(),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, 422);
  assert.equal(outcome.pendingItems?.length, 1);
  assert.equal(outcome.pendingItems?.[0].eventId, "2");

  // Lote já respondido -> 409 (conflito de estado), nunca 422.
  const alreadyResponded = decideContractAlertBatchRespondOutcome({
    batchStatus: "RESPONDED",
    items: [item("1", "RESOLVIDO")],
    responses: [{ eventId: "1", action: "RESOLVIDO" }],
    activeProjectMemberUserIds: new Set(),
  });
  assert.equal(alreadyResponded.ok, false);
  assert.equal(alreadyResponded.status, 409);
});

// ------------------------------------------------------------------
// 8. todos respondidos -> resposta final permitida
// ------------------------------------------------------------------
check("todos respondidos -> resposta final permitida", () => {
  const items = [item("1", null), item("2", null)];
  const responses = [
    { eventId: "1", action: "RESOLVIDO" },
    { eventId: "2", action: "EM_ANDAMENTO" },
  ];
  const outcome = decideContractAlertBatchRespondOutcome({
    batchStatus: "SENT",
    items,
    responses,
    activeProjectMemberUserIds: new Set(),
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.status, 200);
  assert.equal(outcome.respondedItems, 2);
});

// ------------------------------------------------------------------
// Verificações adicionais — template de e-mail, formulário, endpoint,
// migração e auditoria.
// ------------------------------------------------------------------

const email = buildContractAlertBatchEmail({
  recipientName: "Reynaldo",
  projectName: "Complexo Residencial Horizonte",
  batchUrl: "https://acc.exemplo/obra/ledger/lote-alertas/batch-1",
  hasInlineLogo: true,
  items: [
    {
      eventId: "evt-1",
      title: "Solicitação de Aditivo de Prazo",
      severity: "CRITICA",
      riskDescription: "Constructec Ltda. pediu 45 dias de aditivo.",
      clauseLabel: "Cláusula 8.2 – Prazos e Cronograma",
      clauseText: "Qualquer alteração de prazo deve ser aprovada.",
      evidence: [
        "E-mail do fornecedor de 10/09/2026",
        { kind: "OTHER", url: "https://acc.exemplo/obra/evidencias/evt-1-a", sourceTypeLabel: "Diário de Obra", label: "Registro de atraso de insumos" },
      ],
      eventUrl: "https://acc.exemplo/obra/ledger/evt-1",
      respondItemUrl: "https://acc.exemplo/obra/ledger/lote-alertas/batch-1#evento-evt-1",
      quickActionUrl: "https://acc.exemplo/alertas/lote/proj-1/batch-1?evento=evt-1",
    },
    {
      eventId: "evt-2",
      title: "Atraso na entrega de insumos",
      severity: "MEDIA",
      riskDescription: "Atraso reportado no diário de obra.",
      clauseLabel: null,
      clauseText: null,
      evidence: [],
      eventUrl: "https://acc.exemplo/obra/ledger/evt-2",
      respondItemUrl: "https://acc.exemplo/obra/ledger/lote-alertas/batch-1#evento-evt-2",
      quickActionUrl: "https://acc.exemplo/alertas/lote/proj-1/batch-1?evento=evt-2",
    },
  ],
});

check("cada alerta do e-mail tem seu próprio bloco com âncora e coluna de ações aligned", () => {
  assert(email.html.includes('id="evento-evt-1"'));
  assert(email.html.includes('id="evento-evt-2"'));
  // Cada âncora de evento é seguida (na mesma <tr>) por uma coluna de
  // ações própria (acc-batch-actions-col) — nunca uma coluna
  // compartilhada fora do loop por item.
  const perItemActionsColumns = (email.html.match(/class="acc-batch-actions-col"/g) ?? []).length;
  assert.equal(perItemActionsColumns, 2);
  assert.equal(email.html.indexOf("evt-1") < email.html.indexOf("evt-2"), true);
});

check("assunto e corpo refletem graus de risco diferentes no mesmo lote (requisito 7)", () => {
  assert.match(email.subject, /🔴 \[ACC\] 2 alertas/);
  assert(email.html.includes("RISCO CRÍTICO"));
  assert(email.html.includes("RISCO MÉDIO"));
});

check("botão final do e-mail aparece uma única vez e nunca dentro do loop de itens", () => {
  assert.equal((email.html.match(/RESPONDER AO ACC/g) ?? []).length, 1);
  assert(email.text.includes("RESPONDER AO ACC (só libera depois que todos os alertas acima tiverem uma ação)"));
});

check("e-mail nunca contém <select>/<form>/<script> (ENVIADO P/ só é escolhido na página)", () => {
  assert(!/<select/i.test(email.html));
  assert(!/<form/i.test(email.html));
  assert(!/<script/i.test(email.html));
});

check("cabeçalho usa o texto e cores do layout final aprovado", () => {
  assert(email.html.includes("ACC - Acompanhamento de Contratos"));
  assert(email.text.includes("ACC - Acompanhamento de Contratos"));
  // Nome do projeto em vermelho/negrito (ACC_COLOR_HEADING = #7F1D1D).
  assert(email.html.includes('color:#7F1D1D;">Complexo Residencial Horizonte'));
  // Logo do lote é ~25% menor que o do e-mail de alerta único (38px).
  assert(email.html.includes('width="29"'));
});

check("badge de risco fica na mesma linha do título (requisito 2)", () => {
  const block = email.html.slice(email.html.indexOf('id="evento-evt-1"'), email.html.indexOf('id="evento-evt-2"'));
  const badgeIndex = block.indexOf("RISCO CRÍTICO");
  const titleIndex = block.indexOf("Solicitação de Aditivo de Prazo");
  assert(badgeIndex !== -1 && titleIndex !== -1);
  // Ambos dentro da mesma <table><tr> (nenhum </tr> entre os dois).
  const between = block.slice(badgeIndex, titleIndex);
  assert(!between.includes("</tr>"));
});

check("CRÍTICO usa fundo vermelho e fonte branca/negrito", () => {
  assert(email.html.includes("background-color:#dc2626;color:#ffffff;font-family:Arial, Helvetica, sans-serif;font-size:12px;font-weight:bold;padding:5px 12px;border-radius:999px;\">RISCO CRÍTICO"));
});

check('descrição do risco usa o rótulo explícito "Risco: "', () => {
  assert(email.html.includes("<strong>Risco:</strong> Constructec Ltda. pediu 45 dias de aditivo."));
  assert(email.text.includes("Risco: Constructec Ltda. pediu 45 dias de aditivo."));
});

check("os 4 botões de ação usam exatamente as cores do layout aprovado", () => {
  assert(email.html.includes('background-color:#FFD600;color:#000000;') && email.html.includes(">VER EVENTO<"));
  assert(email.html.includes('background-color:#1B2A4A;color:#ffffff;') && email.html.includes(">RESOLVIDO<"));
  assert(email.html.includes('background-color:#15803D;color:#ffffff;') && email.html.includes(">EM ANDAMENTO<"));
  assert(email.html.includes('background-color:#F97316;color:#ffffff;') && email.html.includes(">ENVIADO P/<"));
  // Cada evento tem seu próprio conjunto de 4 botões (2 eventos = 2 de cada).
  assert.equal((email.html.match(/>VER EVENTO</g) ?? []).length, 2);
  assert.equal((email.html.match(/>RESOLVIDO</g) ?? []).length, 2);
  assert.equal((email.html.match(/>EM ANDAMENTO</g) ?? []).length, 2);
  assert.equal((email.html.match(/>ENVIADO P\/</g) ?? []).length, 2);
});

check("botões de ação do e-mail multi-alerta apontam para a página compacta do lote", () => {
  assert(email.html.includes("/alertas/lote/proj-1/batch-1?evento=evt-1&amp;acao=RESOLVIDO"));
  assert(email.html.includes("/alertas/lote/proj-1/batch-1?evento=evt-1&amp;acao=EM_ANDAMENTO"));
  assert(email.html.includes("/alertas/lote/proj-1/batch-1?evento=evt-1&amp;acao=ENVIADO_PARA"));
  assert(email.html.includes("/alertas/lote/proj-1/batch-1?evento=evt-2&amp;acao=ENVIADO_PARA"));
});

check("evidências continuam acessíveis a partir de cada alerta (link para o evento no ACC)", () => {
  assert(email.html.includes("Abrir evidência no ACC"));
  assert(email.html.includes("https://acc.exemplo/obra/ledger/evt-1"));
});

check("sem logo real disponível, o cabeçalho nunca referencia cid: (mesma regra do e-mail de alerta único)", () => {
  const emailWithoutLogo = buildContractAlertBatchEmail({
    recipientName: "Reynaldo",
    projectName: "Complexo Residencial Horizonte",
    batchUrl: "https://acc.exemplo/obra/ledger/lote-alertas/batch-1",
    hasInlineLogo: false,
    items: [
      {
        eventId: "evt-1",
        title: "Solicitação de Aditivo de Prazo",
        severity: "CRITICA",
        riskDescription: "Constructec Ltda. pediu 45 dias de aditivo.",
        clauseLabel: null,
        clauseText: null,
        evidence: [],
        eventUrl: "https://acc.exemplo/obra/ledger/evt-1",
        respondItemUrl: "https://acc.exemplo/obra/ledger/lote-alertas/batch-1#evento-evt-1",
        quickActionUrl: "https://acc.exemplo/alertas/acao/proj-1/batch-1/evt-1",
      },
    ],
  });
  assert(!emailWithoutLogo.html.includes("cid:"));
});

const compactBatchPage = readFileSync(
  "apps/web/app/alertas/lote/[projectId]/[batchId]/page.tsx",
  "utf8"
);
const batchSender = readFileSync(
  "apps/web/lib/email/create-and-send-contract-alert-batch.ts",
  "utf8"
);
const compactPage = readFileSync(
  "apps/web/app/alertas/acao/[projectId]/[batchId]/[eventId]/page.tsx",
  "utf8"
);
const compactForm = readFileSync(
  "apps/web/app/alertas/acao/[projectId]/[batchId]/[eventId]/compact-action-form.tsx",
  "utf8"
);
const compactActions = readFileSync(
  "apps/web/app/alertas/acao/[projectId]/[batchId]/[eventId]/actions.ts",
  "utf8"
);
const form = readFileSync(
  "apps/web/app/[projectId]/ledger/lote-alertas/[batchId]/contract-alert-batch-form.tsx",
  "utf8"
);
const clientActions = readFileSync("apps/web/app/[projectId]/ledger/lote-alertas/[batchId]/actions.ts", "utf8");
const endpoint = readFileSync(
  "apps/web/app/api/contract-alert-batches/[batchId]/respond/route.ts",
  "utf8"
);
const respondFn = readFileSync("apps/web/lib/email-actions/respond-to-contract-alert-batch.ts", "utf8");
const batchPage = readFileSync(
  "apps/web/app/[projectId]/ledger/lote-alertas/[batchId]/page.tsx",
  "utf8"
);
const migration = readFileSync(
  "supabase/migrations/20260921130000_contract_alert_batches_foundation.sql",
  "utf8"
);

check("página identifica o usuário como Responsável, não como destinatário de entrega", () => {
  assert(batchPage.includes("Responsável: {batch.recipientName}"));
  assert(!batchPage.includes("Destinatário: {batch.recipientName}"));
});

check("interface bloqueia RESPONDER AO ACC enquanto houver pendência e mostra lista de pendentes", () => {
  assert(form.includes("disabled={!answeredState.allEventsAnswered || pending}"));
  assert(form.includes("RESPONDER AO ACC"));
  assert(form.includes("Todos os alertas precisam ter uma ação definida antes do envio."));
  assert(form.includes("{answeredState.answeredCount} de {answeredState.totalCount} alertas respondidos"));
  assert(form.includes("resolveContractAlertBatchAnsweredState"));
});

check("VER EVENTO nunca é oferecido como opção de ação no formulário", () => {
  assert(!form.includes('"VER_EVENTO"'));
  assert(form.includes("CONTRACT_ALERT_BATCH_ITEM_ACTIONS"));
});

check("lote com vários alertas usa página compacta única e mantém resposta atômica", () => {
  assert(batchSender.includes("input.items.length === 1"));
  assert(batchSender.includes("/alertas/lote/"));
  assert(compactBatchPage.includes("ContractAlertBatchForm"));
  assert(compactBatchPage.includes("Resposta rápida"));
  assert(compactBatchPage.includes("initialAction={initialAction}"));
  assert(compactBatchPage.includes("members={activeMembers}"));
});

check("página rápida não usa dashboard/sidebar e ENVIADO P/ mostra dropdown de colaborador", () => {
  assert(compactPage.includes("Resposta rápida ao alerta"));
  assert(compactPage.includes("CompactContractAlertActionForm"));
  assert(compactForm.includes('initialAction === "ENVIADO_PARA"'));
  assert(compactForm.includes("Selecione um colaborador"));
  assert(compactForm.includes("CONFIRMAR"));
  assert(compactActions.includes("respondToContractAlertBatch"));
  assert(compactActions.includes("batch.items.length !== 1"));
});

check("página e formulário pré-selecionam a ação vinda do deep link sem gravar nada automaticamente", () => {
  assert(batchPage.includes("searchParams"));
  assert(batchPage.includes("query.acao"));
  assert(batchPage.includes("query.evento"));
  assert(batchPage.includes("isValidContractAlertBatchAction(requestedAction)"));
  assert(batchPage.includes("batch.items.some((item) => item.eventId === requestedEventId)"));
  assert(batchPage.includes("initialAction={initialAction}"));
  assert(form.includes("initialAction"));
  assert(form.includes("initialAction?.eventId === item.eventId ? initialAction.action :"));
  assert(form.includes('actions[item.eventId] === "ENVIADO_PARA"'));
  assert(form.includes("Selecione um colaborador"));
});

check("servidor (Server Action) também recusa resposta incompleta ou ENVIADO P/ sem colaborador", () => {
  assert(clientActions.includes("Todos os alertas precisam ter uma ação definida antes do envio."));
  assert(clientActions.includes('action === "ENVIADO_PARA" && !assignedUserId'));
  assert(clientActions.includes("respondToContractAlertBatch"));
});

check("endpoint HTTP responde 422/409 e nunca grava sem recarregar o lote do banco", () => {
  assert(endpoint.includes("respondToContractAlertBatch"));
  assert(endpoint.includes("status: outcome.status"));
  assert(endpoint.includes("status: 422"));
  assert(respondFn.includes("status: 409"));
  assert(respondFn.includes("decideContractAlertBatchRespondOutcome"));
  // Recarrega itens e membros do projeto do banco antes de decidir —
  // nunca confia em nada vindo do cliente sobre o estado atual.
  assert(respondFn.includes('.from("contract_alert_batch_items")'));
  assert(respondFn.includes('.from("project_memberships")'));
});

check("RPC grava todos os itens do lote na mesma transação e nunca aceita resposta parcial", () => {
  assert(migration.includes("submit_contract_alert_batch_response"));
  assert(migration.includes("v_received_count <> v_expected_count"));
  assert(migration.includes("v_distinct_count <> v_expected_count"));
  assert(migration.includes("for update"));
});

check("ENVIADO_PARA exige colaborador ativo do projeto, validado dentro da RPC", () => {
  const rpcBlock = migration.slice(
    migration.indexOf("if v_action = 'ENVIADO_PARA' then"),
    migration.indexOf("update public.contract_alert_batch_items")
  );
  assert(rpcBlock.includes("coalesce(pm.status, 'ACTIVE') = 'ACTIVE'"));
  assert(rpcBlock.includes("raise exception 'Selecione um colaborador ativo do projeto"));
});

check("isolamento entre projetos: item não pode referenciar evento de outro projeto (trigger)", () => {
  assert(migration.includes("contract_alert_batch_items_assert_same_project"));
  assert(migration.includes("v_batch_project_id <> v_event_project_id"));
  assert(migration.includes("before insert or update of batch_id, event_id on public.contract_alert_batch_items"));
});

check("RLS: apenas SELECT para authenticated — toda escrita passa pela RPC/service role", () => {
  assert(migration.includes('for select to authenticated'));
  assert(!/create policy[^;]*for (insert|update|delete)/is.test(migration));
});

check("FK/ON DELETE preservam rastreabilidade — nunca CASCADE sobre evento/perfil/participação", () => {
  assert(migration.includes("references public.contract_events (id) on delete restrict"));
  assert(migration.includes("references public.profiles (id) on delete restrict"));
  assert(migration.includes("references public.project_memberships (project_id, user_id) on delete restrict"));
  // Cascade só do filho (item) para o pai (lote) e do lote para o projeto.
  assert(migration.includes("references public.contract_alert_batches (id) on delete cascade"));
  assert(migration.includes("references public.projects (id) on delete cascade"));
});

check("migração é puramente aditiva e reversível sem afetar outras funcionalidades", () => {
  assert(migration.includes("PROPOSTA — NÃO APLICADA"));
  assert(migration.includes("Puramente aditiva"));
  assert(!/^\s*alter table public\.(?!contract_alert_batch)/im.test(migration));
  assert(!/drop (table|function|column)/i.test(migration));
});

check("auditoria registra eventId, ação, ator, destinatário do ENVIADO_PARA e correlationId por item", () => {
  const auditBlock = migration.slice(
    migration.indexOf("insert into public.audit_log_entries"),
    migration.indexOf("update public.contract_alert_batches\n  set status = 'RESPONDED'")
  );
  assert(auditBlock.includes("'CONTRACT_ALERT_BATCH_ITEM_RESPONDED', 'CONTRACT_EVENT', v_item.event_id::text"));
  assert(auditBlock.includes("v_action"));
  assert(auditBlock.includes("v_assigned_to"));
  assert(auditBlock.includes("v_batch.correlation_id"));
});

check("auditoria registra também o momento em que a resposta final foi liberada/enviada", () => {
  assert(migration.includes("'CONTRACT_ALERT_BATCH_RESPONDED', 'CONTRACT_ALERT_BATCH', p_batch_id::text"));
  assert(
    /update\s+public\.contract_alert_batches\s+set\s+status\s*=\s*'RESPONDED'\s*,\s*responded_at\s*=\s*now\(\)/is.test(migration)
  );
});

check("vocabulário de ação do lote nunca colide com EmailAlertActionType nem WeeklyDigestResponse existentes", () => {
  const emailActionTypes = readFileSync("apps/web/lib/email-actions/types.ts", "utf8");
  const weeklyDigest = readFileSync("apps/web/lib/email/get-weekly-alert-digest.ts", "utf8");
  assert(!emailActionTypes.includes("ENVIADO_PARA"));
  assert(!emailActionTypes.includes("EM_ANDAMENTO"));
  assert(!weeklyDigest.includes("ENVIADO_PARA"));
  assert.deepEqual(CONTRACT_ALERT_BATCH_ITEM_ACTIONS, ["RESOLVIDO", "EM_ANDAMENTO", "ENVIADO_PARA"]);
  assert.deepEqual(CONTRACT_ALERT_BATCH_ITEM_ACTION_LABELS, {
    RESOLVIDO: "RESOLVIDO",
    EM_ANDAMENTO: "EM ANDAMENTO",
    ENVIADO_PARA: "ENVIADO P/",
  });
});

check("texto usa português do Brasil", () => {
  const combined = `${form}\n${clientActions}\n${endpoint}\n${respondFn}\n${migration}`.toLowerCase();
  for (const forbidden of ["ficheiro", "utilizador", "planeou"]) {
    assert(!combined.includes(forbidden), `termo não brasileiro encontrado: ${forbidden}`);
  }
});

console.log(`\n${passed} verificações concluídas.`);
