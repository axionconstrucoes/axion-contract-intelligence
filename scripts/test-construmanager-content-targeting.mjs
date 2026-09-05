// Pacote C — download direcionado de UM item por vez.
//
// Prova que, com linkId presente, a seleção resolve EXATAMENTE aquele
// alvo e nunca cai no lote automático: um piloto controlado que
// baixasse o documento errado produziria um SHA-256 atribuído ao alvo
// errado.
//
// Nenhuma chamada real, nenhum Supabase, nenhum download: a consulta é
// um dublê que registra as chamadas recebidas.
//
// Uso: node scripts/test-construmanager-content-targeting.mjs

import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./ts-module-resolver.mjs", import.meta.url);

const { applyContentTargetSelection, RETRYABLE_DOWNLOAD_STATUSES } = await import(
  "../apps/web/lib/integrations/construmanager/select-content-targets.ts"
);

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    console.log(`OK   ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL ${name}`);
    failed += 1;
  }
}

// ------------------------------------------------------------
// Dublê do construtor de consulta: registra tudo que recebe e
// devolve a si mesmo, como o supabase-js faz.
// ------------------------------------------------------------

function fakeQuery() {
  const calls = [];
  const builder = {
    calls,
    eq(column, value) {
      calls.push({ method: "eq", column, value });
      return builder;
    },
    in(column, values) {
      calls.push({ method: "in", column, values: [...values] });
      return builder;
    },
    order(column, options) {
      calls.push({ method: "order", column, options });
      return builder;
    },
    limit(count) {
      calls.push({ method: "limit", count });
      return builder;
    },
  };
  return builder;
}

const LINK_DOC = "18458a41-e079-4e53-a5bb-d6995c93dbab";
const LINK_VERSION = "0332fe80-0247-4853-b2f4-e13292c916c9";
const LINK_OUTRO = "ffffffff-ffff-4fff-8fff-ffffffffffff";

console.log("");
console.log("PACOTE C — DOWNLOAD DIRECIONADO POR ITEM");
console.log("========================================");
console.log("");
console.log("-- linkId presente: só aquele alvo --");

const doc = fakeQuery();
applyContentTargetSelection(doc, { linkId: LINK_DOC, batchSize: 2 });

check(
  "botão envia linkId e a seleção vira uma igualdade por id",
  doc.calls.length === 1 &&
    doc.calls[0].method === "eq" &&
    doc.calls[0].column === "id" &&
    doc.calls[0].value === LINK_DOC
);

check(
  "nenhum filtro de status é aplicado no modo direcionado",
  !doc.calls.some((call) => call.method === "in")
);

check(
  "NENHUM limit é aplicado — limit só poderia acrescentar outros alvos",
  !doc.calls.some((call) => call.method === "limit")
);

check(
  "nenhuma ordenação é aplicada no modo direcionado",
  !doc.calls.some((call) => call.method === "order")
);

console.log("");
console.log("-- documento A não baixa documento B --");

const a = fakeQuery();
applyContentTargetSelection(a, { linkId: LINK_DOC, batchSize: 10 });

const b = fakeQuery();
applyContentTargetSelection(b, { linkId: LINK_OUTRO, batchSize: 10 });

check(
  "selecionar o documento A resolve APENAS o id de A",
  a.calls.every((call) => call.method !== "eq" || call.value === LINK_DOC) &&
    !a.calls.some((call) => call.value === LINK_OUTRO)
);

check(
  "selecionar o documento B resolve APENAS o id de B",
  b.calls.every((call) => call.method !== "eq" || call.value === LINK_OUTRO) &&
    !b.calls.some((call) => call.value === LINK_DOC)
);

check(
  "batchSize é ignorado no modo direcionado (não vira lote)",
  !a.calls.some((call) => call.method === "limit")
);

console.log("");
console.log("-- versão histórica pode ser selecionada individualmente --");

const version = fakeQuery();
applyContentTargetSelection(version, { linkId: LINK_VERSION, batchSize: 2 });

check(
  "a versão histórica é resolvida pelo seu próprio linkId",
  version.calls.length === 1 &&
    version.calls[0].method === "eq" &&
    version.calls[0].value === LINK_VERSION
);

check(
  "cabeça e versão são alvos distintos e não se confundem",
  LINK_DOC !== LINK_VERSION &&
    doc.calls[0].value !== version.calls[0].value
);

console.log("");
console.log("-- lote automático permanece funcional quando NÃO há linkId --");

const batch = fakeQuery();
applyContentTargetSelection(batch, { linkId: null, batchSize: 2 });

check(
  "sem linkId, filtra por status pendente/erro",
  batch.calls.some(
    (call) =>
      call.method === "in" &&
      call.column === "download_status" &&
      call.values.join(",") === "PENDENTE,ERRO"
  )
);

check(
  "sem linkId, ordena e aplica o limite do lote",
  batch.calls.some((call) => call.method === "order") &&
    batch.calls.some((call) => call.method === "limit" && call.count === 2)
);

check(
  "sem linkId, nenhuma igualdade por id é aplicada",
  !batch.calls.some((call) => call.method === "eq" && call.column === "id")
);

check(
  "string vazia não é tratada como alvo (cairia no lote, não em id='')",
  (() => {
    const empty = fakeQuery();
    applyContentTargetSelection(empty, { linkId: "", batchSize: 3 });
    return (
      !empty.calls.some((call) => call.method === "eq") &&
      empty.calls.some((call) => call.method === "limit" && call.count === 3)
    );
  })()
);

check(
  "status reaproveitáveis são exatamente PENDENTE e ERRO",
  RETRYABLE_DOWNLOAD_STATUSES.join(",") === "PENDENTE,ERRO"
);

// ------------------------------------------------------------
// Auditoria da UI e da action
// ------------------------------------------------------------

console.log("");
console.log("-- UI e Server Action --");

const componentSource = readFileSync(
  "apps/web/components/integrations/construmanager-content-download.tsx",
  "utf8"
);

const actionSource = readFileSync(
  "apps/web/app/[projectId]/integracoes/actions.ts",
  "utf8"
);

check(
  "cada linha baixável tem seu próprio form com o linkId daquele item",
  /name="linkId" value=\{item\.linkId\}/.test(componentSource)
);

check(
  "o botão da linha é submit do form que carrega o linkId",
  /<Button\s+type="submit"[\s\S]{0,400}?onClick=\{\(\) => setActiveLinkId\(item\.linkId\)\}/.test(
    componentSource
  )
);

check(
  "só linha PENDENTE ou ERRO recebe botão Baixar",
  /function isDownloadable[\s\S]{0,220}?item\.status === "PENDENTE" \|\| item\.status === "ERRO"/.test(
    componentSource
  ) && /isDownloadable\(item\) \?/.test(componentSource)
);

check(
  "botões ficam desabilitados enquanto há download em curso (um por vez)",
  // A trava passou a ser `busy`, que cobre download E preparação. A
  // garantia original (nenhum segundo download enquanto um roda)
  // continua valendo — `busy` inclui `pending` —, e agora vale também
  // durante a preparação, que escreve na mesma tabela de vínculos.
  /const busy = pending \|\| preparing;/.test(componentSource) &&
    (componentSource.match(/disabled=\{busy\}/g) ?? []).length >= 1
);

check(
  "lote automático está oculto durante o piloto",
  /const SHOW_BATCH_DOWNLOAD = false;/.test(componentSource) &&
    /\{SHOW_BATCH_DOWNLOAD \?/.test(componentSource)
);

check(
  "o form de lote é o ÚNICO que envia batchSize",
  (componentSource.match(/name="batchSize"/g) ?? []).length === 1
);

check(
  "a action delega a seleção ao módulo testável",
  /applyContentTargetSelection\(query, \{\s*linkId: requestedLinkId,\s*batchSize,\s*\}\)/.test(
    actionSource
  )
);

check(
  "a action não reimplementa a seleção por fora do helper",
  !/query\.eq\("id", requestedLinkId\)/.test(actionSource)
);

check(
  "o painel lista todos os itens e filtra por nome (203 alvos são localizáveis)",
  /overview\?\.items/.test(componentSource) &&
    /item\.sourceName\.toLocaleLowerCase\(\)\.includes\(term\)/.test(componentSource)
);

check(
  "nenhum link público ou download para o navegador foi introduzido",
  !/getPublicUrl|createSignedUrl|<a\s+download|href=\{/.test(componentSource)
);

check(
  "a UI não compara revisões nem cria evento (isso é Pacote D)",
  !/CONTEUDO_ALTERADO|event_ledger|compareRevision/i.test(componentSource)
);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);

process.exit(failed === 0 ? 0 : 1);
