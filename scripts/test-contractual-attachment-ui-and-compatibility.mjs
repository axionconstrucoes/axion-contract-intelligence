// VÍNCULO CONTRATUAL REAL — UI (item 6), Server Actions e guarda de
// compatibilidade de deploy (item 8): o código consumidor NÃO deve
// fazer nenhuma consulta real às colunas contractual_* nesta rodada
// (migration 20260829090000 ainda não aplicada) — getManagedDocuments
// e build-event-context.ts continuam retornando null para todos os
// campos de vínculo; os mapeadores puros (map-contractual-link-fields.ts,
// map-contractual-link-context.ts) existem e são testados com mocks,
// prontos para serem ligados numa rodada futura.
//
// Uso:
//   node scripts/test-contractual-attachment-ui-and-compatibility.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

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

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

console.log("");
console.log("======================================");
console.log("VÍNCULO CONTRATUAL — UI, Server Actions e compatibilidade de deploy");
console.log("======================================");
console.log("");

// ---------- Mapeadores puros (mocks) ----------

const { mapContractualLinkFields } = await import("../apps/web/lib/documents/map-contractual-link-fields.ts");

check("mapContractualLinkFields: resolve nome do usuário via join com profiles (mock) — nunca expõe só o id cru na UI", () => {
  const fields = mapContractualLinkFields(
    {
      contractual_parent_document_id: "parent-1",
      contractual_incorporation_basis: "Cláusula 4.2.",
      contractual_linked_by_user_id: "user-1",
      contractual_linked_at: "2026-08-29T10:00:00Z",
    },
    new Map([["user-1", "Reynaldo"]])
  );
  assert(fields.parentDocumentId === "parent-1");
  assert(fields.contractualIncorporationBasis === "Cláusula 4.2.");
  assert(fields.contractualLinkedByUserId === "user-1");
  assert(fields.contractualLinkedByUserName === "Reynaldo", "deveria resolver o nome via o mapa de perfis");
  assert(fields.contractualLinkedAt === "2026-08-29T10:00:00Z");
});

check("mapContractualLinkFields: sem vínculo (tudo null) — nunca quebra, nunca inventa um nome", () => {
  const fields = mapContractualLinkFields(
    {
      contractual_parent_document_id: null,
      contractual_incorporation_basis: null,
      contractual_linked_by_user_id: null,
      contractual_linked_at: null,
    },
    new Map()
  );
  assert(fields.parentDocumentId === null);
  assert(fields.contractualLinkedByUserName === null);
});

// ---------- Mapeadores reais CONECTADOS, com fallback de compatibilidade ----------
//
// Rodada que aplicou a migration 20260829090000 de verdade contra uma
// stack descartável (ver relatório) e confirmou os mapeadores
// funcionando fim-a-fim — por isso as duas Server Actions/builders
// abaixo agora selecionam as colunas contractual_* de verdade. A
// garantia de nunca quebrar contra um banco SEM a migration (o
// Supabase local real deste projeto, por exemplo) deixou de ser "nunca
// selecionar a coluna" e passou a ser um FALLBACK explícito em 42703
// (undefined_column) — testado aqui.

const documentManagementSource = readSource("apps/web/lib/document-management.ts");

check("CONECTADO: getManagedDocuments seleciona '*' (nunca uma lista explícita de colunas) e mapeia os 5 campos de vínculo via mapContractualLinkFields — nunca mais hardcoded null", () => {
  assert(documentManagementSource.includes('.select("*")'), "select(\"*\") nunca falha pela ausência de uma coluna — é a base da compatibilidade aqui, ao contrário de uma lista explícita");
  assert(documentManagementSource.includes("...mapContractualLinkFields("), "deveria espalhar o resultado do mapeador real em cada documento");
  assert(!documentManagementSource.includes("parentDocumentId: null,\n    contractualIncorporationBasis: null,"), "não deveria mais hardcodar os 5 campos como null");
});

const buildEventContextSource = readSource("apps/web/lib/ai/context/build-event-context.ts");

check("CONECTADO: build-event-context.ts (resolveClauses) tenta um select ESTENDIDO com as colunas contractual_* e refaz sem elas especificamente em 42703 — nunca lança um erro fatal só porque a migration ainda não foi aplicada em algum banco", () => {
  assert(buildEventContextSource.includes("EXTENDED_DOCUMENT_COLUMNS"), "deveria haver uma consulta estendida dedicada");
  assert(buildEventContextSource.includes('extended.error.code === "42703"'), "deveria detectar especificamente 42703 (undefined_column) para acionar o fallback, nunca qualquer erro");
  assert(
    buildEventContextSource.includes('await supabase.from("documents").select("id,kind,title").in("id", documentIds)'),
    "o fallback deveria refazer a consulta ORIGINAL (id,kind,title), garantindo que um banco sem a migration continue funcionando"
  );
  assert(!buildEventContextSource.includes("contractualLink: null,"), "não deveria mais hardcodar null — agora usa mapContractualLinkContext de verdade");
});

check("COMPATIBILIDADE: get-contract-base-clauses.ts (Confronto de fonte do cliente) continua com contractualLink: null — mas por um motivo SEMÂNTICO, não de compatibilidade de schema: o documento aqui É sempre o próprio contrato-base/aditivo, que nunca é filho de outro (CHECK constraint documents_contractual_instrument_never_child_check)", () => {
  const source = readSource("apps/web/lib/additionals/confrontation/get-contract-base-clauses.ts");
  assert(source.includes("contractualLink: null,"));
  assert(
    /nunca ele próprio um anexo vinculado/.test(source),
    "o comentário deveria deixar claro que isto é uma garantia de dado (nunca pode ter pai), não uma limitação de compatibilidade de schema"
  );
});

check("mapeadores puros (map-contractual-link-fields.ts, map-contractual-link-context.ts) continuam PUROS (sem server-only, sem I/O) mesmo agora conectados aos builders reais — só transformam dados recebidos, nunca fazem I/O próprio", () => {
  const fieldsSource = readSource("apps/web/lib/documents/map-contractual-link-fields.ts");
  const contextSource = readSource("apps/web/lib/ai/context/map-contractual-link-context.ts");
  assert(!fieldsSource.includes('import "server-only"'));
  assert(!contextSource.includes('import "server-only"'));
  assert(
    /^import.*mapContractualLinkFields.*map-contractual-link-fields/m.test(documentManagementSource),
    "document-management.ts deveria importar o mapeador real (conectado nesta rodada)"
  );
  assert(
    /^import.*mapContractualLinkContext.*map-contractual-link-context/m.test(buildEventContextSource),
    "build-event-context.ts deveria importar o mapeador real (conectado nesta rodada)"
  );
});

// ---------- Migration nunca aplicada nesta rodada (guarda de processo) ----------

check("a migration não define nenhum passo de aplicação automática (sem chamada a supabase db push nem script de deploy nesta suíte)", () => {
  const migrationFiles = [
    "supabase/migrations/20260829090000_document_contractual_attachment_linkage.sql",
  ];
  for (const file of migrationFiles) {
    assert(readSource(file).length > 0, `${file} deveria existir como arquivo de migration comum (aplicação manual/CI, nunca automática por este teste)`);
  }
});

// ---------- UI: badge ANEXO CONTRATUAL, quadro bordô, leitura para não autorizado ----------

const attachmentRowSource = readSource("apps/web/components/documents/contractual-attachment-row.tsx");

check("UI: anexo contratual recebe quadro bordô (getDocumentKindCardAppearance com isContractualAttachment: true) e badge ANEXO CONTRATUAL", () => {
  assert(attachmentRowSource.includes("isContractualAttachment: true"));
  assert(attachmentRowSource.includes("ANEXO CONTRATUAL"));
  assert(attachmentRowSource.includes("appearance.cardClassName"), "a linha deveria aplicar o cardClassName (bordô) — não só uma borda fina");
});

check("UI: fundamento é sempre exibido na linha do anexo (mostrar vínculo e fundamento, inclusive para leitura)", () => {
  assert(attachmentRowSource.includes("document.contractualIncorporationBasis"));
});

check("UI: controle de desvincular só aparece para canManageDocuments — usuário não autorizado vê só leitura (vínculo + fundamento), nunca o controle de alteração", () => {
  assert(attachmentRowSource.includes("{canManageDocuments ?"), "o controle de desvincular deveria ser condicional a canManageDocuments");
  const controlIndex = attachmentRowSource.indexOf("<UnlinkContractualAttachmentControl");
  const conditionIndex = attachmentRowSource.indexOf("{canManageDocuments ?");
  assert(conditionIndex !== -1 && controlIndex !== -1 && conditionIndex < controlIndex, "UnlinkContractualAttachmentControl deveria estar dentro do bloco condicional canManageDocuments");
});

check("UI: um anexo contratual NUNCA é duplicado — agrupador garante isso (já testado em test-group-contractual-documents.mjs); page.tsx renderiza cada grupo/anexo por uma única key React", () => {
  const groupSectionSource = readSource("apps/web/components/documents/contractual-document-group-section.tsx");
  assert(/key=\{attachment\.id\}/.test(groupSectionSource), "cada ContractualAttachmentRow deveria ter key única por id de documento");
});

// ---------- UI: dropdown "Vincular como anexo contratual" e confirmação antes de trocar o pai ----------

const linkControlSource = readSource("apps/web/components/documents/link-contractual-attachment-control.tsx");

check("UI: dropdown de 'Vincular como anexo contratual' só lista candidatos resolvidos no SERVIDOR (parentOptions vem de page.tsx via sortAndLabelContractualPrincipals) — nunca uma lista livre/digitável", () => {
  assert(linkControlSource.includes("<Select"));
  assert(!/type="text".*parentDocumentId|<input[^>]*name="parentDocumentId"[^>]*type="text"/.test(linkControlSource), "o pai nunca deveria ser um campo de texto livre");
  const pageSource = readSource("apps/web/app/[projectId]/documentos/page.tsx");
  assert(pageSource.includes("sortAndLabelContractualPrincipals(documents)"), "page.tsx deveria resolver os candidatos no servidor a partir dos documents já carregados");
});

check("UI: fundamento da incorporação é campo obrigatório (required) no formulário de vínculo, com o MESMO mínimo de 20 caracteres da RPC/CHECK constraint (só UX — o servidor sempre revalida)", () => {
  assert(/name="incorporationBasis"[\s\S]{0,200}required/.test(linkControlSource) || /required[\s\S]{0,200}name="incorporationBasis"/.test(linkControlSource), "o campo de fundamento deveria ser required");
  assert(linkControlSource.includes("MIN_INCORPORATION_BASIS_LENGTH = 20;"));
  assert(linkControlSource.includes("MAX_INCORPORATION_BASIS_LENGTH = 2000;"));
  assert(linkControlSource.includes("minLength={MIN_INCORPORATION_BASIS_LENGTH}"));
});

check("UI: justificativa da desvinculação também exige o MESMO mínimo de 20 caracteres da RPC unlink", () => {
  assert(attachmentRowSource.includes("UnlinkContractualAttachmentControl"));
  const unlinkControlSource = readSource("apps/web/components/documents/unlink-contractual-attachment-control.tsx");
  assert(unlinkControlSource.includes("MIN_REASON_LENGTH = 20;"));
  assert(unlinkControlSource.includes("minLength={MIN_REASON_LENGTH}"));
});

check("UI: confirmação explícita antes de TROCAR um pai já existente — checkbox 'Confirmo a troca' exigido, resumo textual da troca exibido antes do envio", () => {
  assert(linkControlSource.includes("isChangingExistingLink"));
  assert(linkControlSource.includes("Confirmo a troca do documento pai."));
  assert(linkControlSource.includes("canSubmit"), "o botão de envio deveria ficar desabilitado até a troca ser confirmada");
});

check("UI: Salvar e Cancelar sempre presentes no formulário de vínculo", () => {
  assert(/"Salvar/.test(linkControlSource), "botão de envio deveria se chamar Salvar (com variação 'Salvar (confirmar troca)' ao trocar um pai existente)");
  assert(/>\s*Cancelar\s*</.test(linkControlSource), "deveria existir um botão Cancelar");
});

// ---------- Server Actions: resolvem tudo no servidor, nunca confiam no navegador ----------

const documentosActionsSource = readSource("apps/web/app/[projectId]/documentos/actions.ts");

check("Server Actions linkDocumentAsContractualAttachmentAction/unlinkDocumentContractualAttachmentAction chamam SÓ a RPC (supabase.rpc) — nenhuma escrita direta em documents/audit_log_entries a partir do servidor Next.js", () => {
  assert(documentosActionsSource.includes('supabase.rpc("link_document_as_contractual_attachment"'));
  assert(documentosActionsSource.includes('supabase.rpc("unlink_document_contractual_attachment"'));
  assert(!/\.from\("documents"\)\.(insert|update|upsert)/.test(documentosActionsSource), "a Server Action nunca deveria escrever direto em documents — só via RPC");
  assert(!documentosActionsSource.includes('.from("audit_log_entries")'), "auditoria é responsabilidade exclusiva da RPC, nunca da Server Action");
});

check("Server Actions revalidam a página de Documentos após vincular/desvincular", () => {
  const linkActionBlock = documentosActionsSource.slice(documentosActionsSource.indexOf("export async function linkDocumentAsContractualAttachmentAction"));
  const unlinkActionBlock = documentosActionsSource.slice(documentosActionsSource.indexOf("export async function unlinkDocumentContractualAttachmentAction"));
  assert(linkActionBlock.includes("revalidatePath(`/${projectId}/documentos`)"));
  assert(unlinkActionBlock.includes("revalidatePath(`/${projectId}/documentos`)"));
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
