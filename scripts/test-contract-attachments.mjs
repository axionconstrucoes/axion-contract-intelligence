// "ANEXOS DO CONTRATO" — reaproveita document_version_files (file_role
// = 'ANEXO_CONTRATUAL', migration 20260825010713) para o card de
// CONTRATO_BASE. Nenhuma tabela nova, nenhum pipeline de Storage
// paralelo. Checagens estruturais (leitura de código-fonte/migration),
// mesmo padrão já usado por scripts/test-brand-background.mjs e
// scripts/test-acc-navigation-performance.mjs — sem subir um servidor
// Next.js real nem um banco Postgres real (esses dois últimos exigiriam
// a stack descartável, fora do escopo autorizado nesta rodada; a
// autorização/matriz de papéis é verificada aqui pela LEITURA do corpo
// da migration, e ao vivo no Preview — ver relatório).
//
// Cobre os 18 cenários pedidos: 1 (sem anexos), 2 (um/vários), 3
// (upload múltiplo), 4 (contador), 5 (visualização/download), 6
// (vínculo com a versão correta), 7 (contrato principal preservado), 8
// (exclusão de só um anexo), 9 (bloqueio por evidência), 10-13 (matriz
// ADMINISTRADOR/GERENTE/COLABORADOR/LEITURA), 14 (usuário fora do
// projeto), 15 (falha de upload), 16 (arquivo inválido), 17
// (auditoria), 18 (ausência de duplicidade após retentativa).
//
// Uso:
//   node scripts/test-contract-attachments.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
console.log('ANEXOS DO CONTRATO — TESTES');
console.log("======================================");
console.log("");

const migrationSource = readSource(
  "supabase/migrations/20260831210000_contract_attachments_authorization_and_delete.sql"
);
const panelSource = readSource("apps/web/components/documents/contract-attachments/contract-attachments-panel.tsx");
const hookSource = readSource("apps/web/components/documents/contract-attachments/use-contract-attachments.ts");
const cardSource = readSource("apps/web/components/documents/document-card.tsx");
const pageSource = readSource("apps/web/app/[projectId]/documentos/page.tsx");
const documentManagementSource = readSource("apps/web/lib/document-management.ts");
const eligibleKindSource = readSource(
  "apps/web/lib/documents/contract-attachments/is-contract-attachment-eligible-kind.ts"
);

// --- 0. Reaproveitamento de infraestrutura (nenhuma tabela/pipeline novo) ---

check("nenhuma tabela nova é criada — migration só adiciona funções/índice sobre document_version_files já existente", () => {
  assert(!/create table/i.test(migrationSource), "não deveria haver CREATE TABLE nesta migration");
  assert(migrationSource.includes("document_version_files"), "deveria operar sobre document_version_files");
});

check("card só mostra o painel para document.kind elegível (CONTRATO_BASE), via helper central, nunca comparação inline duplicada", () => {
  assert(eligibleKindSource.includes('kind === "CONTRATO_BASE"'), "helper central deveria decidir CONTRATO_BASE");
  assert(cardSource.includes("isContractAttachmentEligibleKind(document.kind)"), "DocumentCard deveria usar o helper central");
  assert(pageSource.includes("isContractAttachmentEligibleKind(document.kind)"), "page.tsx deveria usar o helper central");
  assert(!/document\.kind === "CONTRATO_BASE"/.test(pageSource), "page.tsx não deveria comparar kind inline");
});

// --- 1. Contrato sem anexos ---

check("1. contrato sem anexos: painel mostra 'Nenhum anexo cadastrado' quando a lista carregada está vazia", () => {
  assert(panelSource.includes("Nenhum anexo cadastrado"), "mensagem de vazio ausente");
  assert(/loaded && attachments\.length === 0/.test(panelSource), "condição de vazio deveria checar loaded && length === 0");
});

// --- 2. Contrato com um e vários anexos / contador ---

check("2. contrato com um ou vários anexos: painel mapeia TODOS os itens de `attachments` (sem limite artificial)", () => {
  assert(/attachments\.map\(\(attachment\)/.test(panelSource), "deveria mapear todos os anexos, um AttachmentRow por item");
});

check("4. contador: resumo mostra 'Anexos do Contrato (N)', N = attachments.length quando carregado, senão initialCount (SSR)", () => {
  assert(panelSource.includes("Anexos do Contrato ({count})"), "texto do contador ausente/alterado");
  assert(/const count = loaded \? attachments\.length : initialCount/.test(panelSource), "lógica do contador incorreta");
});

check("4b. getContractAttachmentCounts (SSR) conta só file_role = ANEXO_CONTRATUAL, agrupado por document_version_id", () => {
  assert(documentManagementSource.includes("getContractAttachmentCounts"), "função de contagem ausente");
  assert(documentManagementSource.includes('.eq("file_role", "ANEXO_CONTRATUAL")'), "contagem deveria filtrar por file_role");
});

// --- 3. Upload múltiplo ---

check("3. upload múltiplo: <input type=\"file\" multiple> presente; addFiles processa a FileList inteira em lotes", () => {
  assert(/type="file"\s+multiple/.test(panelSource) || /multiple[\s\S]{0,40}type="file"/.test(panelSource), "input de arquivo deveria aceitar múltiplos");
  assert(/for \(let i = 0; i < list\.length/.test(hookSource), "addFiles deveria iterar por toda a lista de arquivos");
});

// --- 5. Visualização/download ---

check("5. visualização e download: dois botões distintos, ambos via URL assinada (createSignedUrl); só 'Baixar' força download", () => {
  assert(panelSource.includes("Visualizar"), "botão Visualizar ausente");
  assert(panelSource.includes("Baixar"), "botão Baixar ausente");
  assert(panelSource.includes("createSignedUrl"), "deveria usar URL assinada temporária");
  assert(
    /forceDownload \? \{ download: attachment\.originalFileName \} : undefined/.test(panelSource),
    "só a ação de baixar deveria passar a opção download"
  );
});

check("5b. nunca expõe o bucket como público — createSignedUrl aponta para o bucket real do registro, nunca uma URL pública fixa", () => {
  assert(!/getPublicUrl/.test(panelSource), "não deveria usar getPublicUrl (bucket é privado)");
});

// --- 6. Vínculo com a versão correta ---

check("6. upload sempre vinculado ao document_version_id da versão atual (prop documentVersionId, nunca outro id)", () => {
  assert(hookSource.includes("p_document_version_id: documentVersionId"), "RPC deveria receber o documentVersionId da versão atual");
  assert(
    hookSource.includes("${projectId}/${documentId}/${documentVersionId}/anexos-contratuais/"),
    "path de Storage deveria incluir o documentVersionId da versão atual"
  );
});

// --- 7. Contrato principal preservado ---

check("7. upload de anexo NUNCA usa file_role PRINCIPAL — sempre ANEXO_CONTRATUAL, nunca substitui/cria o arquivo principal", () => {
  assert(hookSource.includes('p_file_role: "ANEXO_CONTRATUAL"'), "upload de anexo deveria sempre usar file_role ANEXO_CONTRATUAL");
});

check("7b. delete_contract_attachment recusa explicitamente qualquer file_role diferente de ANEXO_CONTRATUAL (nunca remove o PRINCIPAL)", () => {
  assert(migrationSource.includes("v_file_role <> 'ANEXO_CONTRATUAL'"), "checagem de file_role ausente na RPC de remoção");
  assert(migrationSource.includes("This RPC only removes ANEXO_CONTRATUAL files."), "mensagem de recusa ausente");
});

check("7c. document_version_files_one_principal_idx (migration original) garante um único PRINCIPAL por versão — nunca tocado por esta migration", () => {
  assert(!migrationSource.includes("document_version_files_one_principal_idx"), "esta migration não deveria mexer no índice do PRINCIPAL");
});

// --- 8. Exclusão de apenas um anexo ---

check("8. remoção exige confirmação explícita (dois cliques: 'Remover anexo do contrato' -> 'Confirmar remoção'), nunca 'Excluir definitivamente' fora de comentários explicativos", () => {
  assert(panelSource.includes("Remover anexo do contrato"), "botão inicial 'Remover anexo do contrato' ausente");
  assert(panelSource.includes("Confirmar remoção"), "confirmação explícita ausente");
  assert(panelSource.includes("Cancelar"), "opção de cancelar ausente");
  // Remove comentários de bloco {/* ... */} e de linha // antes de checar —
  // o próprio código comenta "Nunca 'Excluir definitivamente'" como
  // explicação da decisão de design; isso não deveria contar como o
  // texto aparecendo na interface de verdade (JSX renderizado).
  const withoutBlockComments = panelSource.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const withoutComments = withoutBlockComments.replace(/\/\/.*$/gm, "");
  assert(!/Excluir definitivamente/i.test(withoutComments), "não deveria usar 'Excluir definitivamente' fora de comentários (o objeto físico é preservado)");
});

check("8d. confirmação explica explicitamente que o vínculo é removido da visualização e o arquivo histórico é preservado para auditoria", () => {
  assert(
    panelSource.includes("O vínculo será removido da visualização. O arquivo histórico permanecerá preservado para auditoria."),
    "texto explicativo da confirmação ausente ou alterado"
  );
});

check("8b. delete_contract_attachment identifica o anexo SOMENTE por p_file_id (chave primária) — nunca por nome/posição, nunca em lote", () => {
  const signature = migrationSource.match(/create or replace function public\.delete_contract_attachment\(\s*p_file_id uuid\s*\)/);
  assert(signature, "assinatura de delete_contract_attachment deveria receber só p_file_id");
  assert(migrationSource.includes("where f.id = p_file_id"), "deveria localizar a linha exclusivamente por id");
  assert(migrationSource.includes("delete from public.document_version_files\n  where id = p_file_id;"), "DELETE deveria ser escopado a um único id");
});

check("8c. exclusão bem-sucedida remove só o item deletado do estado local (nunca a lista inteira)", () => {
  assert(
    /setAttachments\(\(prev\) => prev\.filter\(\(attachment\) => attachment\.id !== fileId\)\)/.test(hookSource),
    "deveria filtrar só o item excluído do estado local"
  );
});

// --- 9. Bloqueio de anexo usado como evidência ---

check("9. delete_contract_attachment bloqueia a remoção quando a versão está referenciada em event_evidence, com mensagem explicando o motivo", () => {
  assert(migrationSource.includes("event_evidence"), "checagem de evidência ausente");
  assert(
    migrationSource.includes("referenciada como evidência de um evento do Event Ledger"),
    "mensagem explicando o bloqueio por evidência ausente"
  );
});

check("9b. delete_contract_attachment também bloqueia por confronto/registro protegido — mesmas 4 checagens de trash_project_document (event_cross_references direto, via cláusula, e Proposta de Adicional)", () => {
  assert(migrationSource.includes("event_cross_references ecr\n    where ecr.document_id = v_document_id"), "checagem de event_cross_references (documento) ausente");
  assert(migrationSource.includes("existe referência direta a este documento no Event Ledger"), "mensagem de cross-reference direta ausente");
  assert(migrationSource.includes("join public.clauses c\n      on c.id = ecr.clause_id"), "checagem de event_cross_references via cláusula ausente");
  assert(migrationSource.includes("uma cláusula desta versão está referenciada no Event Ledger"), "mensagem de cláusula referenciada ausente");
  assert(migrationSource.includes("project_additional_proposal_links papl"), "checagem de Proposta de Adicional ausente");
  assert(migrationSource.includes("vinculada a uma Proposta de Adicional"), "mensagem de vínculo com Proposta de Adicional ausente");
});

check("9c. nenhuma alteração parcial: TODAS as checagens de proteção rodam ANTES do DELETE (nunca depois)", () => {
  const deleteIndex = migrationSource.indexOf("delete from public.document_version_files\n  where id = p_file_id;");
  const evidenceIndex = migrationSource.indexOf("from public.event_evidence ee");
  const crossRefIndex = migrationSource.indexOf("from public.event_cross_references ecr\n    where ecr.document_id");
  const proposalIndex = migrationSource.indexOf("from public.project_additional_proposal_links papl");
  assert(deleteIndex > 0, "DELETE não encontrado");
  assert(evidenceIndex > 0 && evidenceIndex < deleteIndex, "checagem de evidência deveria vir antes do DELETE");
  assert(crossRefIndex > 0 && crossRefIndex < deleteIndex, "checagem de cross-reference deveria vir antes do DELETE");
  assert(proposalIndex > 0 && proposalIndex < deleteIndex, "checagem de Proposta de Adicional deveria vir antes do DELETE");
});

// --- 10-13. Matriz de permissões ---

check("10-13. can_add_contract_attachment: ADMINISTRADOR, GESTOR/GERENTE e COLABORADOR incluem; LEITURA (ausente da lista) nunca inclui", () => {
  const fnMatch = migrationSource.match(/create or replace function public\.can_add_contract_attachment[\s\S]*?\$\$;/);
  assert(fnMatch, "função can_add_contract_attachment não encontrada");
  const body = fnMatch[0];
  assert(body.includes("'ADMINISTRADOR'"), "ADMINISTRADOR deveria incluir anexos");
  assert(body.includes("'GESTOR'"), "GESTOR (sinônimo de GERENTE) deveria incluir anexos");
  assert(body.includes("'GERENTE'"), "GERENTE deveria incluir anexos");
  assert(body.includes("'COLABORADOR'"), "COLABORADOR deveria incluir anexos");
  assert(!body.includes("'LEITURA'"), "LEITURA não deveria estar na lista de quem inclui anexos");
});

check("10-13b. exclusão (delete_contract_attachment) reaproveita can_manage_project_documents (ADMINISTRADOR/GESTOR/GERENTE) — COLABORADOR e LEITURA nunca excluem", () => {
  assert(
    migrationSource.includes("if not public.can_manage_project_documents(v_project_id) then"),
    "delete_contract_attachment deveria reaproveitar can_manage_project_documents para exclusão"
  );
});

check("10-13c. register_document_version_file ramifica autorização por p_file_role: ANEXO_CONTRATUAL usa can_add_contract_attachment; os demais papéis continuam ADMINISTRADOR-only (comportamento herdado, inalterado)", () => {
  assert(
    migrationSource.includes("if p_file_role = 'ANEXO_CONTRATUAL' then\n    v_authorized := public.can_add_contract_attachment(v_project_id);"),
    "ramificação de autorização para ANEXO_CONTRATUAL ausente/alterada"
  );
  assert(
    migrationSource.includes("v_authorized := public.has_project_permission(v_project_id, 'ADMINISTRADOR');"),
    "EVIDENCIA_APROVACAO/DOCUMENTO_APOIO deveriam continuar ADMINISTRADOR-only"
  );
});

check("10-13d. page.tsx: canAddContractAttachment inclui COLABORADOR; canDeleteContractAttachment é exatamente canUpload (ADMINISTRADOR/GESTOR/GERENTE)", () => {
  assert(
    pageSource.includes('const canAddContractAttachment = canUpload || permission === "COLABORADOR";'),
    "canAddContractAttachment deveria incluir COLABORADOR além de canUpload"
  );
  assert(
    pageSource.includes("const canDeleteContractAttachment = canUpload;"),
    "canDeleteContractAttachment deveria ser exatamente canUpload"
  );
});

check("10-13e. painel: quando canAdd=false, nenhum input de upload é oferecido; quando canDelete=false, nenhum botão de excluir é oferecido (LEITURA só visualiza/baixa)", () => {
  assert(/\{canAdd \? \(/.test(panelSource), "área de upload deveria ser condicionada a canAdd");
  assert(/canDelete &&/.test(panelSource), "botão de remoção deveria ser condicionado a canDelete");
});

// --- 14. Acesso de usuário fora do projeto ---

check("14. RPCs nunca recebem project_id do cliente — sempre resolvido no servidor a partir da linha real (impede acesso cruzado de projeto)", () => {
  assert(
    !/create or replace function public\.delete_contract_attachment\([^)]*p_project_id/.test(migrationSource),
    "delete_contract_attachment não deveria receber p_project_id como parâmetro"
  );
  assert(
    !/create or replace function public\.register_document_version_file\([^)]*p_project_id/.test(migrationSource),
    "register_document_version_file não deveria receber p_project_id como parâmetro"
  );
  assert(
    migrationSource.includes("from public.document_version_files f\n  join public.document_versions dv"),
    "delete_contract_attachment deveria resolver o projeto via join a partir do file_id real"
  );
});

check("14b. leitura de anexos (SELECT) continua protegida por RLS via is_project_member (herdada, não tocada nesta migration)", () => {
  const linkageMigration = readSource("supabase/migrations/20260825010713_document_version_file_packages.sql");
  assert(linkageMigration.includes("is_project_member"), "policy de SELECT deveria exigir is_project_member");
  assert(!migrationSource.includes("create policy"), "esta migration não deveria criar/alterar policies de RLS (herda as existentes)");
});

// --- 15. Falha de upload ---

check("15. falha de upload do Storage vira status ERRO com mensagem classificada (reaproveita classifyStorageUploadError do multi-upload existente)", () => {
  assert(hookSource.includes("classifyStorageUploadError"), "deveria reaproveitar a classificação de erro já existente");
  assert(hookSource.includes('status: "ERRO", errorMessage: classifyStorageUploadError(uploadError.message)'), "falha de upload deveria virar status ERRO");
});

check("15b. falha após upload bem-sucedido (registro na RPC) limpa o objeto órfão do Storage (reaproveita removeOrphanedStorageObject)", () => {
  assert(hookSource.includes("removeOrphanedStorageObject"), "deveria limpar o objeto órfão em caso de falha no registro");
});

// --- 16. Arquivo inválido ---

check("16. arquivo vazio, maior que 50MB, ou com extensão não permitida é rejeitado ANTES do upload (mesmas regras do multi-upload, nunca ampliadas)", () => {
  assert(hookSource.includes("file.size <= 0"), "deveria rejeitar arquivo vazio");
  assert(hookSource.includes("file.size > MAX_FILE_SIZE_BYTES"), "deveria rejeitar arquivo acima do limite");
  assert(hookSource.includes("!expectedMimeType"), "deveria rejeitar extensão não mapeada em MIME_BY_EXTENSION");
  assert(
    hookSource.includes('from "@/lib/documents/multi-upload/allowed-file-types"'),
    "deveria reaproveitar a allowlist existente, nunca uma nova lista paralela"
  );
});

check("16b. DWG não está na allowlist atual — não foi adicionado por esta tarefa (regra de segurança verificada antes de qualquer ampliação)", () => {
  const allowedTypesSource = readSource("apps/web/lib/documents/multi-upload/allowed-file-types.ts");
  assert(!/dwg/i.test(allowedTypesSource), "DWG não deveria ter sido adicionado à allowlist sem uma decisão de segurança separada e explícita");
});

// --- 17. Auditoria ---

check("17. adicionar anexo grava audit_log_entries (DOCUMENT_VERSION_FILE_ADDED) — herdado da migration original, inalterado", () => {
  assert(migrationSource.includes("'DOCUMENT_VERSION_FILE_ADDED'"), "auditoria de inclusão ausente");
});

check("17b. remover anexo grava audit_log_entries (DOCUMENT_VERSION_FILE_DELETED) com nome do arquivo e path de Storage preservado", () => {
  assert(migrationSource.includes("'DOCUMENT_VERSION_FILE_DELETED'"), "auditoria de remoção ausente");
  assert(migrationSource.includes("arquivo histórico permanece preservado no Storage"), "detalhe da auditoria deveria registrar que o Storage foi preservado");
});

check("17c. objeto de Storage NUNCA é apagado pela exclusão — só o metadado; mesma filosofia do bucket (sem policy de DELETE)", () => {
  assert(!/storage\.objects/.test(migrationSource.match(/delete_contract_attachment[\s\S]*?\$\$;/)?.[0] ?? ""), "delete_contract_attachment não deveria tocar storage.objects");
});

// --- 18. Ausência de duplicidade após retentativa ---

check("18. índice único parcial (document_version_id, sha256_hash) WHERE file_role = ANEXO_CONTRATUAL impede duas linhas para o mesmo conteúdo — garantia real do Postgres, não só um SELECT prévio", () => {
  assert(
    migrationSource.includes("create unique index document_version_files_contract_attachment_hash_idx"),
    "índice único de deduplicação ausente"
  );
  assert(
    migrationSource.includes("where file_role = 'ANEXO_CONTRATUAL' and sha256_hash is not null"),
    "índice deveria ser escopado a ANEXO_CONTRATUAL com hash presente"
  );
});

check("18b. violação do índice único é traduzida em DUPLICATE_ATTACHMENT_HASH (mensagem clara, nunca um erro genérico de constraint)", () => {
  assert(migrationSource.includes("DUPLICATE_ATTACHMENT_HASH"), "tradução da violação de unicidade ausente");
  assert(migrationSource.includes("get stacked diagnostics v_conflicting_constraint = constraint_name;"), "deveria identificar a constraint via diagnostics, mesmo padrão de register_project_document_upload");
});

check("18c. cliente trata DUPLICATE_ATTACHMENT_HASH como status DUPLICADO amigável, nunca como falha genérica", () => {
  assert(hookSource.includes("DUPLICATE_ATTACHMENT_HASH"), "hook deveria reconhecer o erro de duplicidade");
  assert(hookSource.includes('status: isDuplicate ? "DUPLICADO" : "ERRO"'), "deveria diferenciar DUPLICADO de ERRO genérico");
});

// --- Storage: caminho de upload sempre sob o path imutável projeto/documento/versão ---

check("upload de anexo grava sob projectId/documentId/documentVersionId/anexos-contratuais/ — nunca fora do prefixo já validado pela RPC (v_expected_prefix)", () => {
  assert(migrationSource.includes("v_expected_prefix :="), "validação de prefixo de storage_path deveria continuar existindo");
  assert(hookSource.includes("anexos-contratuais"), "subpasta dedicada para anexos deveria existir (evita colidir com o arquivo PRINCIPAL)");
});

// --- Nomenclatura: interface exibe exclusivamente GERENTE ---

check("nomenclatura: nenhum arquivo novo/alterado desta feature exibe 'GESTOR' como texto de botão/mensagem/auditoria (só permitido como valor interno de compatibilidade, dentro de comparações de permissão)", () => {
  for (const [name, source] of [
    ["contract-attachments-panel.tsx", panelSource],
    ["use-contract-attachments.ts", hookSource],
    ["document-card.tsx", cardSource],
  ]) {
    assert(!/GESTOR/.test(source), `${name} não deveria mencionar GESTOR de forma alguma (nem interno — nenhum destes arquivos lida com o papel do usuário diretamente)`);
  }
  // page.tsx e a migration PODEM conter 'GESTOR' — mas só dentro de
  // comparação de permissão (comparação com pm.permission ou a
  // variável `permission`) ou comentário, nunca como rótulo de botão/
  // mensagem exibida. Checado indiretamente: nenhuma string literal
  // teria "GESTOR" fora de um contexto de comparação/lista de papéis.
  assert(!/>GESTOR</.test(pageSource), "page.tsx não deveria renderizar 'GESTOR' como texto visível");
});

check("nomenclatura: seletor de papel (Usuários) nunca mostra 'Gerente' duas vezes — GESTOR (legado) só ocupa a posição de GERENTE quando é o valor JÁ salvo do membro, nunca uma opção extra", () => {
  const memberRowSource = readSource("apps/web/components/users/member-row-actions.tsx");
  assert(!memberRowSource.includes("ALL_PERMISSIONS"), "constante antiga com as 5 permissões lado a lado (duplicava 'Gerente' no <select>) deveria ter sido substituída");
  assert(memberRowSource.includes("buildSelectablePermissions"), "função que evita a opção duplicada deveria existir");
  assert(
    memberRowSource.includes('["ADMINISTRADOR", "GERENTE", "COLABORADOR", "LEITURA"]'),
    "lista padrão (membro não-GESTOR) não deveria incluir GESTOR"
  );
  assert(
    memberRowSource.includes('["ADMINISTRADOR", "GESTOR", "COLABORADOR", "LEITURA"]'),
    "lista para membro atualmente GESTOR deveria substituir GERENTE por GESTOR na mesma posição (nunca as duas ao mesmo tempo)"
  );
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
