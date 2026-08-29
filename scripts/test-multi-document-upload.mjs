// Testes do upload múltiplo de Documentos (fila com dedup, versão,
// conflito e Ata de Reunião). A migration nova
// (20260825130000_multi_document_upload_foundation) AINDA NÃO FOI
// APLICADA em nenhum ambiente — por isso parte da cobertura aqui é
// ESTRUTURAL (leitura de código-fonte/SQL), mesmo padrão já usado em
// scripts/test-user-management.mjs. A lógica pura de fila/dedup
// (apps/web/lib/documents/multi-upload/queue-core.ts) é importada e
// executada de verdade — não é só regex. Nenhum upload real, nenhum
// e-mail, nenhuma ingestão.
//
// Uso:
//   node scripts/test-multi-document-upload.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
// Normaliza CRLF -> LF: neste checkout (Windows, core.autocrlf) os
// arquivos ficam em disco com \r\n, mas as buscas abaixo (indexOf/regex
// com \n literal) foram escritas assumindo LF — sem isso, indexOf nunca
// encontra o marcador de fim de bloco esperado, o slice() cai de volta
// para "quase o arquivo inteiro" e os asserts seguintes ficam sujeitos a
// falso positivo/negativo por pegarem trechos errados do arquivo. Este
// normalize corrige a causa (mismatch de line ending), não os sintomas.
function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
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

async function checkAsync(name, fn) {
  try {
    await fn();
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
console.log("UPLOAD MÚLTIPLO DE DOCUMENTOS — TESTES");
console.log("======================================");
console.log("");

const {
  sanitizeFileName,
  resolveExtension,
  resolveMimeType,
  deriveTitleFromFileName,
  normalizeTitleForMatching,
  buildDescriptor,
  validateDescriptor,
  buildSelectionKey,
  mergeNewFiles,
  classifyCandidate,
  nextVersionLabel,
  progressForPhase,
  computeBatchSummary,
  isBatchStillActive,
  isMppFile,
  suggestedKindForDescriptor,
  classifyStorageUploadError,
  toExistingDocumentSnapshots,
  buildImportErrorMessage,
} = await import(
  "../apps/web/lib/documents/multi-upload/queue-core.ts"
);

const { PHASE_ORDER, PHASE_WEIGHTS, MULTI_UPLOAD_DOCUMENT_KINDS } =
  await import("../apps/web/lib/documents/multi-upload/types.ts");

const { computeSha256Hex, computeFileSha256Hex } = await import(
  "../apps/web/lib/documents/multi-upload/sha256.ts"
);

const {
  MAX_FILE_SIZE_BYTES,
  MIME_BY_EXTENSION,
  ACCEPT_ATTRIBUTE,
} = await import("../apps/web/lib/documents/multi-upload/allowed-file-types.ts");

// --- 1. Seleção: multiseleção, sem perder anteriores, dedup no lote ---

check("multiseleção: dois lotes de seleção se acumulam, nada do primeiro se perde", () => {
  const first = [buildDescriptor("a.pdf", 100), buildDescriptor("b.pdf", 200)];
  const { toAdd: afterFirst } = mergeNewFiles([], first);
  assert(afterFirst.length === 2, "primeiro lote deveria adicionar 2");

  const second = [buildDescriptor("c.pdf", 300)];
  const { toAdd: afterSecond } = mergeNewFiles(afterFirst, second);
  assert(afterSecond.length === 1, "segundo lote deveria adicionar só o novo");

  const combined = [...afterFirst, ...afterSecond];
  assert(combined.length === 3, "os 3 arquivos das duas seleções deveriam coexistir");
  assert(combined.map((d) => d.name).includes("a.pdf"), "arquivo do primeiro lote não deveria sumir");
});

check("seleção: duplicação dentro do próprio lote (mesmo nome+tamanho) é recusada na entrada", () => {
  const existing = [buildDescriptor("contrato.pdf", 1000)];
  const incoming = [buildDescriptor("contrato.pdf", 1000), buildDescriptor("outro.pdf", 500)];
  const { toAdd, skipped } = mergeNewFiles(existing, incoming);
  assert(toAdd.length === 1 && toAdd[0].name === "outro.pdf", "só o arquivo realmente novo deveria ser adicionado");
  assert(skipped.length === 1 && skipped[0].name === "contrato.pdf", "o repetido deveria ser sinalizado como pulado");
});

check("remoção antes do início: buildSelectionKey é estável para o mesmo arquivo (permite localizar e remover)", () => {
  const d1 = buildDescriptor("Ata 25-08.pdf", 5000);
  const d2 = buildDescriptor("Ata 25-08.pdf", 5000);
  assert(buildSelectionKey(d1) === buildSelectionKey(d2), "mesma chave para nome+tamanho idênticos");
});

check("upload individual: fluxo próprio preservado (mesma RPC, sem acoplamento à FILA do upload múltiplo) — a ÚNICA coisa reaproveitada do módulo multi-upload é o utilitário puro de hash (sha256.ts), deliberado para fechar a lacuna real de deduplicação deste formulário; nunca importa queue-core/types/allowed-file-types (a máquina de fila em si)", () => {
  const uploadForm = readSource("apps/web/components/documents/document-upload-form.tsx");
  assert(uploadForm.includes("register_project_document_upload"), "fluxo individual deveria continuar chamando a mesma RPC");
  assert(uploadForm.includes('from "@/lib/documents/multi-upload/sha256"'), "deveria reaproveitar o utilitário de hash do upload múltiplo, nunca duplicar a lógica");
  for (const queueModule of ["multi-upload/queue-core", "multi-upload/types", "multi-upload/allowed-file-types", "use-document-upload-queue"]) {
    assert(!uploadForm.includes(queueModule), `upload individual não deveria se acoplar à máquina de fila do upload múltiplo (${queueModule})`);
  }
});

check("arrastar e soltar: onDrop chama addFiles com event.dataTransfer.files, onDragOver previne o comportamento padrão do navegador", () => {
  const panelSource = readSource("apps/web/components/documents/multi-upload/document-multi-upload-panel.tsx");
  assert(/onDrop=\{handleDrop\}/.test(panelSource));
  assert(/function handleDrop\(event: DragEvent<HTMLDivElement>\) \{/.test(panelSource));
  assert(/addFiles\(event\.dataTransfer\.files\)/.test(panelSource));
  assert(/event\.preventDefault\(\)/.test(panelSource), "onDrop/onDragOver deveriam preventDefault (senão o navegador abre o arquivo)");
});

// --- 2. Fila: campos, tipo documental (12 valores exatos) ---

check("fila: os 12 tipos documentais exigidos, com os rótulos exatos pedidos", () => {
  const expected = [
    "Contrato", "Aditivo Contratual", "Ata de Reunião", "Cronograma",
    "Proposta Comercial", "Proposta Técnica", "Planilha Contratual",
    "Relatório", "Notificação", "ESG/SSMA", "Diário de Obra", "Outro",
  ];
  const labels = MULTI_UPLOAD_DOCUMENT_KINDS.map((k) => k.label);
  assert(labels.length === 12, `esperado 12 tipos, obtido ${labels.length}`);
  for (const label of expected) {
    assert(labels.includes(label), `tipo documental ausente: ${label}`);
  }
});

check("fila: cada QueueItem carrega nome/extensão/tamanho/tipo/status/progresso/erro (via QueueFileDescriptor + campos do tipo)", () => {
  const typesSource = readSource("apps/web/lib/documents/multi-upload/types.ts");
  for (const field of ["name", "extension", "sizeBytes", "kind", "status", "progressPercent", "errorMessage"]) {
    assert(new RegExp(`\\b${field}\\b`).test(typesSource), `campo ausente no tipo da fila: ${field}`);
  }
});

check("fila: botões remover (antes do início) e tentar novamente (após falha) existem na linha da fila", () => {
  const rowSource = readSource("apps/web/components/documents/multi-upload/queue-item-row.tsx");
  assert(/onRemove/.test(rowSource) && /Remover/.test(rowSource));
  assert(/onRetry/.test(rowSource) && /Tentar novamente/.test(rowSource));
  assert(/REMOVABLE_STATUSES.*PENDENTE|PENDENTE.*REMOVABLE/s.test(rowSource) || rowSource.includes('new Set(["PENDENTE"])'), "remover deveria só valer antes do início");
});

check("fila: tipo padrão do lote + alteração individual por arquivo", () => {
  const panelSource = readSource("apps/web/components/documents/multi-upload/document-multi-upload-panel.tsx");
  assert(/batchDefaultKind/.test(panelSource), "seletor de tipo padrão do lote ausente");
  assert(/setItemKind/.test(panelSource) || readSource("apps/web/components/documents/multi-upload/queue-item-row.tsx").includes("onKindChange"), "alteração individual por arquivo ausente");
});

// --- 3. Progresso: fases, pesos, nunca tempo decorrido ---

check("progresso: as 6 fases exigidas, nesta ordem", () => {
  assert(
    PHASE_ORDER.join(",") === "VALIDACAO,HASH,UPLOAD,REGISTRO,PROCESSAMENTO,CONCLUIDO",
    `ordem obtida: ${PHASE_ORDER.join(",")}`
  );
});

check("progresso: pesos das fases somam exatamente 100", () => {
  const total = Object.values(PHASE_WEIGHTS).reduce((a, b) => a + b, 0);
  assert(total === 100, `soma obtida: ${total}`);
});

check("progresso: percentual por arquivo é monotônico crescente conforme fases concluem (nunca tempo decorrido)", () => {
  let previous = -1;
  for (const phase of PHASE_ORDER) {
    const value = progressForPhase(phase, true);
    assert(value > previous, `fase ${phase} deveria avançar o percentual (${value} <= ${previous})`);
    previous = value;
  }
  assert(previous === 100, "última fase concluída deveria chegar a 100%");
});

check("progresso: nenhum componente novo usa Date.now()/setInterval/elapsed time para simular percentual", () => {
  for (const file of [
    "apps/web/components/documents/multi-upload/use-document-upload-queue.ts",
    "apps/web/components/documents/multi-upload/document-multi-upload-panel.tsx",
    "apps/web/components/documents/multi-upload/queue-item-row.tsx",
    "apps/web/components/documents/multi-upload/upload-summary-bar.tsx",
  ]) {
    const source = readSource(file);
    assert(!/setInterval|Date\.now\(\)|elapsed/i.test(source), `${file} não deveria simular progresso por tempo`);
  }
});

check("progresso: barra geral e individual usam o componente Progress existente (value real, nunca timer)", () => {
  const summarySource = readSource("apps/web/components/documents/multi-upload/upload-summary-bar.tsx");
  const rowSource = readSource("apps/web/components/documents/multi-upload/queue-item-row.tsx");
  assert(summarySource.includes('from "@/components/ui/progress"'), "barra geral deveria reusar o componente Progress");
  assert(rowSource.includes('from "@/components/ui/progress"'), "barra individual deveria reusar o componente Progress");
});

check("progresso: resumo do lote traz total/concluídos/processando/duplicados/rejeitados/com erro — TODO status terminal (com ou sem sucesso) conta 100% no cálculo do progresso geral, nunca o progressPercent bruto da fase onde parou", () => {
  const items = [
    { status: "CONCLUIDO", progressPercent: 100 },
    { status: "CONCLUIDO", progressPercent: 100 },
    { status: "ENVIANDO", progressPercent: 60 }, // não-terminal: continua contando o valor bruto
    { status: "DUPLICADO", progressPercent: 20 }, // terminal: conta 100, não 20
    { status: "REJEITADO", progressPercent: 5 }, // terminal: conta 100, não 5
    { status: "ERRO", progressPercent: 70 }, // terminal: conta 100, não 70
  ];
  const summary = computeBatchSummary(items);
  assert(summary.total === 6);
  assert(summary.completed === 2);
  assert(summary.processing === 1);
  assert(summary.duplicated === 1);
  assert(summary.rejected === 1);
  assert(summary.errored === 1);
  assert(
    summary.overallPercent === Math.round((100 + 100 + 60 + 100 + 100 + 100) / 6),
    `overallPercent deveria tratar todo status terminal como 100% de peso, obtido ${summary.overallPercent}`
  );
});

check("progresso: lote 100% terminal (1 concluído + 1 duplicado + 1 erro + 0 processando) chega a 100%, mesmo contendo erro — cenário exato do relatório (lote nunca saía de 'Enviando lote...')", () => {
  const items = [
    { status: "CONCLUIDO", progressPercent: 100 },
    { status: "DUPLICADO", progressPercent: 20 },
    { status: "ERRO", progressPercent: 20 },
  ];
  const summary = computeBatchSummary(items);
  assert(summary.processing === 0);
  assert(summary.overallPercent === 100, `lote inteiramente terminal deveria mostrar 100%, obtido ${summary.overallPercent}%`);
});

check("isBatchStillActive: false quando não há PENDENTE nem fase em andamento (mesmo com itens aguardando decisão humana) — sinal usado para reabilitar o botão 'Iniciar envio' e sair de 'Enviando lote...'", () => {
  const allTerminalOrWaiting = [
    { status: "CONCLUIDO" },
    { status: "DUPLICADO" },
    { status: "ERRO" },
    { status: "AGUARDANDO_DECISAO_VERSAO" },
  ];
  assert(isBatchStillActive(allTerminalOrWaiting) === false, "nenhum destes status representa trabalho automático em andamento");

  const withPending = [{ status: "CONCLUIDO" }, { status: "PENDENTE" }];
  assert(isBatchStillActive(withPending) === true, "PENDENTE ainda é trabalho automático a fazer");

  const withActivePhase = [{ status: "CONCLUIDO" }, { status: "ENVIANDO" }];
  assert(isBatchStillActive(withActivePhase) === true, "ENVIANDO é uma fase ativa em andamento");
});

check("use-document-upload-queue.ts: isRunning é reabilitado (volta a false) quando o lote para de ter trabalho ativo — nunca fica travado em 'Enviando lote...' para sempre; a checagem é feita dentro de tick() (evento), nunca num useEffect reagindo a `items` (setState síncrono em efeito é evitado de propósito)", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  assert(hookSource.includes("isBatchStillActive"), "hook deveria usar isBatchStillActive para saber quando o lote realmente terminou");
  assert(
    /activeIdsRef\.current\.size === 0 && !isBatchStillActive\(itemsRef\.current\)\)\s*\{\s*setIsRunning\(/.test(hookSource),
    "tick() deveria chamar setIsRunning(false) quando não há mais trabalho ativo (nem em voo, nem PENDENTE)"
  );
  const tickBody = hookSource.slice(hookSource.indexOf("const tick = useCallback("), hookSource.indexOf("}, [processItem]);"));
  assert(!/useEffect\(/.test(tickBody), "a lógica deveria estar dentro de tick() (chamada por evento), não dentro de um useEffect");
});

// --- 4. Processamento: independência, sucesso parcial, nome original, hash real ---

await checkAsync("processamento: SHA-256 real bate com o vetor de teste conhecido de 'abc'", async () => {
  const encoder = new TextEncoder();
  const hash = await computeSha256Hex(encoder.encode("abc").buffer);
  const expected =
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  assert(hash === expected, `esperado ${expected}, obtido ${hash}`);
  assert(/^[0-9a-f]{64}$/.test(hash), "hash deveria ser hex minúsculo de 64 caracteres");
});

await checkAsync("processamento: computeFileSha256Hex (via Blob) bate com computeSha256Hex (via ArrayBuffer)", async () => {
  const text = "conteudo de teste do upload multiplo";
  const blob = new Blob([text]);
  const viaBlob = await computeFileSha256Hex(blob);
  const viaBuffer = await computeSha256Hex(new TextEncoder().encode(text).buffer);
  assert(viaBlob === viaBuffer, "os dois caminhos deveriam produzir o mesmo hash");
});

check("processamento: cada arquivo é independente — continueAfterDecision nunca usa Promise.all (falha de um não cancela o lote)", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  assert(!/Promise\.all/.test(hookSource), "não deveria agregar os arquivos numa única promise que falha junto");
  assert(/catch \(caughtError\)/.test(hookSource), "continueAfterDecision deveria capturar erros por arquivo, nunca deixar escapar");
});

check("processamento: concorrência é limitada (MAX_CONCURRENCY definido e usado no motor de fila)", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  assert(/const MAX_CONCURRENCY = \d+/.test(hookSource), "limite de concorrência ausente");
  assert(/MAX_CONCURRENCY - activeIdsRef\.current\.size/.test(hookSource), "o tick deveria respeitar o limite de vagas livres");
});

check("processamento: nome original preservado (original_file_name = file.name, não o sanitizado)", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  assert(/p_original_file_name: file\.name/.test(hookSource), "o nome original enviado ao servidor deveria ser o não sanitizado");
  assert(/sanitizeFileName\(file\.name\)/.test(hookSource), "o caminho de Storage deveria usar o nome sanitizado");
});

check("processamento: SHA-256 é calculado e enviado ao registro (p_sha256_hash)", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  assert(/computeFileSha256Hex/.test(hookSource));
  assert(/p_sha256_hash: current\.sha256Hash/.test(hookSource));
});

check("processamento: projeto/usuário/data/origem/tipo são registrados na chamada da RPC", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  for (const param of ["p_project_id", "p_author", "p_document_date", "p_source_type", "p_kind"]) {
    assert(hookSource.includes(param), `parâmetro ausente na chamada de registro: ${param}`);
  }
});

check("processamento: caminho de Storage nunca sobrescreve silenciosamente — upsert:false no upload", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  assert(/upsert:\s*false/.test(hookSource), "upload deveria continuar com upsert:false, mesmo padrão do upload individual");
});

check("processamento: status é rastreável em todas as fases (nenhum estado \"limbo\" sem status/fase correspondente)", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  for (const status of ["VALIDANDO", "CALCULANDO_HASH", "ENVIANDO", "REGISTRANDO", "PROCESSANDO", "CONCLUIDO"]) {
    assert(hookSource.includes(`"${status}"`), `transição de status ausente no hook: ${status}`);
  }
});

// --- 5. Deduplicação e incremental: NOVO / NOVA_VERSAO / DUPLICADO / CONFLITO ---

check("duplicidade: hash já existente em qualquer documento do projeto -> DUPLICADO, nunca reenvia", () => {
  const existing = toExistingDocumentSnapshots([
    { id: "doc-1", title: "Contrato Base", kind: "CONTRATO_BASE", versions: [{ versionIndex: 1, sha256Hash: "hash-x" }] },
  ]);
  const result = classifyCandidate({
    sha256Hash: "hash-x",
    fileName: "copia-do-contrato.pdf",
    kind: "CONTRATO_BASE",
    existingDocuments: existing,
    batchHashIndex: new Map(),
    currentQueueItemId: "item-2",
  });
  assert(result.classification === "DUPLICADO");
  assert(result.matchedDocumentId === "doc-1");
});

check("duplicidade: hash repetido dentro do MESMO lote (arquivo diferente já hasheado antes) -> DUPLICADO", () => {
  const batchHashIndex = new Map([["hash-y", "item-1"]]);
  const result = classifyCandidate({
    sha256Hash: "hash-y",
    fileName: "arquivo-2.pdf",
    kind: "OUTRO",
    existingDocuments: [],
    batchHashIndex,
    currentQueueItemId: "item-2",
  });
  assert(result.classification === "DUPLICADO");
  assert(/lote/.test(result.reason));
});

check("prioridade: mesmo hash E mesmo título (mesmo tipo) -> DUPLICADO, NUNCA NOVA_VERSAO (conteúdo idêntico vence sobre título)", () => {
  const existing = toExistingDocumentSnapshots([
    { id: "doc-1", title: "Contrato Base", kind: "CONTRATO_BASE", versions: [{ versionIndex: 1, sha256Hash: "hash-identico" }] },
  ]);
  const result = classifyCandidate({
    sha256Hash: "hash-identico",
    fileName: "Contrato Base.pdf", // mesmo título normalizado do documento existente
    kind: "CONTRATO_BASE", // mesmo tipo também
    existingDocuments: existing,
    batchHashIndex: new Map(),
    currentQueueItemId: "item-1",
  });
  assert(result.classification === "DUPLICADO", `deveria ser DUPLICADO mesmo com título e tipo batendo também, obtido ${result.classification}`);
});

check("nova versão: título normalizado bate + HASH DIFERENTE do já existente + mesmo tipo documental -> NOVA_VERSAO, com rótulo de versão calculado", () => {
  const existing = toExistingDocumentSnapshots([
    { id: "doc-1", title: "Cronograma Obra", kind: "CRONOGRAMA_BASELINE", versions: [{ versionIndex: 1, sha256Hash: "hash-old" }, { versionIndex: 2, sha256Hash: "hash-old-2" }] },
  ]);
  const result = classifyCandidate({
    sha256Hash: "hash-new",
    fileName: "Cronograma_Obra.xlsx",
    kind: "CRONOGRAMA_BASELINE",
    existingDocuments: existing,
    batchHashIndex: new Map(),
    currentQueueItemId: "item-1",
  });
  assert(result.classification === "NOVA_VERSAO");
  assert(result.matchedDocumentId === "doc-1");
  assert(nextVersionLabel(existing[0]) === "3.0", `esperado 3.0, obtido ${nextVersionLabel(existing[0])}`);
});

check("conflito: título bate mas tipo documental diverge -> CONFLITO, exige decisão humana (nunca resolvido sozinho)", () => {
  const existing = toExistingDocumentSnapshots([
    { id: "doc-1", title: "Reuniao Kickoff", kind: "ATA_REUNIAO", versions: [{ versionIndex: 1, sha256Hash: "hash-a" }] },
  ]);
  const result = classifyCandidate({
    sha256Hash: "hash-b",
    fileName: "Reuniao Kickoff.pdf",
    kind: "NOTIFICACAO",
    existingDocuments: existing,
    batchHashIndex: new Map(),
    currentQueueItemId: "item-1",
  });
  assert(result.classification === "CONFLITO");
  assert(result.matchedDocumentId === "doc-1");
});

check("novo: sem hash nem título correspondente -> NOVO", () => {
  const result = classifyCandidate({
    sha256Hash: "hash-unico",
    fileName: "Arquivo Nunca Visto.pdf",
    kind: "OUTRO",
    existingDocuments: [],
    batchHashIndex: new Map(),
    currentQueueItemId: "item-1",
  });
  assert(result.classification === "NOVO");
  assert(result.matchedDocumentId === null);
});

// ---------- Deduplicação — cenários explícitos (seção 6) ----------

check("dedup: mesmo projeto + mesmo hash, NOMES DIFERENTES -> DUPLICADO (hash vence, nunca decide por nome)", () => {
  const result = classifyCandidate({
    sha256Hash: "hash-abc",
    fileName: "nome-completamente-diferente.pdf",
    kind: "OUTRO",
    existingDocuments: [
      { documentId: "doc-1", title: "Título Original", kind: "OUTRO", versions: [{ sha256Hash: "hash-abc" }], nextVersionIndex: 2 },
    ],
    batchHashIndex: new Map(),
    currentQueueItemId: "item-1",
  });
  assert(result.classification === "DUPLICADO");
  assert(result.matchedDocumentId === "doc-1");
});

check("dedup: MESMO NOME, hashes DIFERENTES -> nunca DUPLICADO (pode ser NOVA_VERSAO, decidido pelo conteúdo/hash, nunca só pelo nome)", () => {
  const result = classifyCandidate({
    sha256Hash: "hash-conteudo-novo",
    fileName: "Relatorio Semanal.pdf",
    kind: "RELATORIO",
    existingDocuments: [
      { documentId: "doc-1", title: "Relatorio Semanal", kind: "RELATORIO", versions: [{ sha256Hash: "hash-conteudo-antigo" }], nextVersionIndex: 2 },
    ],
    batchHashIndex: new Map(),
    currentQueueItemId: "item-1",
  });
  assert(result.classification !== "DUPLICADO", "mesmo nome com conteúdo diferente nunca é duplicado");
  assert(result.classification === "NOVA_VERSAO");
});

check("dedup: PROJETOS DIFERENTES nunca deduplicam entre si — existingDocuments já vem sempre pré-filtrado por projeto (getManagedDocuments/RLS); classifyCandidate não tem acesso a nenhum dado de outro projeto, então um hash que só existe no OUTRO projeto nunca aparece aqui e o resultado é NOVO", () => {
  // Simula o snapshot de um projeto B que não conhece o hash cadastrado
  // no projeto A — a própria ausência do dado é a garantia estrutural.
  const projectBExistingDocuments = [
    { documentId: "doc-projeto-b-1", title: "Outro Documento", kind: "OUTRO", versions: [{ sha256Hash: "hash-so-existe-no-projeto-a" }], nextVersionIndex: 2 },
  ];
  const result = classifyCandidate({
    sha256Hash: "hash-so-existe-no-projeto-a", // mesmo hash, mas classificando DENTRO do snapshot do projeto B
    fileName: "arquivo.pdf",
    kind: "OUTRO",
    existingDocuments: projectBExistingDocuments,
    batchHashIndex: new Map(),
    currentQueueItemId: "item-1",
  });
  // Neste teste o hash FOI incluído no snapshot do projeto B de propósito
  // (simulando um erro de isolamento) — o ponto real é que em produção
  // esse snapshot nunca teria essa linha, pois toExistingDocumentSnapshots
  // só recebe documentos já filtrados por projeto (getManagedDocuments).
  assert(result.classification === "DUPLICADO", "sanity: classifyCandidate deduplica pelo que está NO snapshot recebido");
  const migration = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(/d\.project_id = p_project_id\s*\n\s*and dv\.sha256_hash = p_sha256_hash/.test(migration), "a garantia real de isolamento por projeto é a checagem servidor-side escopada por project_id (fail-closed, nunca confia só no snapshot client-side)");
});

check("dedup: versões com mesmo hash mostram uma única versão — bloqueado na ORIGEM (índice único project_id+sha256_hash impede a segunda linha de sequer ser gravada), nunca uma dedup só de exibição sobre registros duplicados já existentes", () => {
  const migration = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(/unique[\s\S]{0,20}\(\s*project_id,\s*sha256_hash\s*\)|on public\.document_versions \(project_id, sha256_hash\)/i.test(migration), "deveria existir um índice único (project_id, sha256_hash) prevenindo duplicatas na origem");
});

check("dedup: toExistingDocumentSnapshots nunca inventa/mistura dados de outro projeto — só transforma exatamente os documentos recebidos (já filtrados por quem chama)", () => {
  const snapshots = toExistingDocumentSnapshots([
    { id: "doc-1", title: "Doc A", kind: "OUTRO", versions: [{ versionIndex: 1, sha256Hash: "hash-1" }] },
  ]);
  assert(snapshots.length === 1, "não deveria adicionar nenhum documento extra");
  assert(snapshots[0].documentId === "doc-1");
});

check("decisão humana: hook só avança NOVA_VERSAO/CONFLITO depois de confirmVersionDecision/confirmConflictAsNew explícitos", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  assert(/status === "NOVA_VERSAO"/.test(hookSource) === false, "não deveria haver comparação direta nesse ponto"); // sanity: usa classification.classification
  assert(/"AGUARDANDO_DECISAO_VERSAO"/.test(hookSource));
  assert(/"AGUARDANDO_DECISAO_CONFLITO"/.test(hookSource));
  assert(/confirmVersionDecision/.test(hookSource) && /confirmConflictAsNew/.test(hookSource));
});

check("servidor recusa duplicidade de novo (fail-closed), mesmo se o cliente deixar passar", () => {
  const migration = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(/DUPLICATE_FILE_HASH/.test(migration), "RPC deveria recusar hash duplicado no servidor");
  assert(/d\.project_id = p_project_id\s*\n\s*and dv\.sha256_hash = p_sha256_hash/.test(migration), "checagem deveria ser escopada por projeto");
});

check("nunca sobrescreve documento existente silenciosamente: version_label único por documento continua exigido", () => {
  const migration = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(/Version label already exists for this document/.test(migration));
});

// --- 5b. Assinatura da RPC: sem ambiguidade de overload ---

const upgradeMigration = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");

check("assinatura: a versão antiga da RPC (15 parâmetros, sem hash) é DROPADA explicitamente antes de recriar", () => {
  assert(
    /drop function if exists public\.register_project_document_upload\(\s*uuid, uuid, uuid, text, text, text, date, text, text, text,\s*\n\s*text, text, text, bigint, text\s*\n\);/.test(upgradeMigration),
    "DROP da assinatura de 15 parâmetros ausente ou com tipos diferentes do que está hoje em produção"
  );
});

check("assinatura: chamada nova com hash — p_sha256_hash existe, é o último parâmetro, com default", () => {
  assert(
    /p_notes text default null,\s*\n\s*p_sha256_hash text default null/.test(upgradeMigration),
    "p_sha256_hash deveria ser o último parâmetro da function, com default null"
  );
});

check("ausência de ambiguidade: só existe UMA definição de register_project_document_upload nesta migration (nenhuma sobrecarga)", () => {
  const matches = upgradeMigration.match(/create or replace function public\.register_project_document_upload/g) ?? [];
  assert(matches.length === 1, `deveria haver exatamente 1 CREATE OR REPLACE desta function, encontrado ${matches.length}`);
});

check("ausência de ambiguidade: DROP (15 tipos) e CREATE (16 tipos) têm listas de tipos realmente diferentes, não é o mesmo texto repetido", () => {
  const dropMatch = upgradeMigration.match(/drop function if exists public\.register_project_document_upload\(([\s\S]*?)\);/);
  const createMatch = upgradeMigration.match(/create or replace function public\.register_project_document_upload\(([\s\S]*?)\)\nreturns uuid/);
  assert(dropMatch && createMatch, "não encontrei os dois blocos para comparar");
  const countTypes = (s) => s.split(",").length;
  const dropParamCount = countTypes(dropMatch[1]);
  const createParamCount = (createMatch[1].match(/^\s*p_\w+/gm) ?? []).length;
  assert(dropParamCount === 15, `DROP deveria listar 15 tipos, contei ${dropParamCount}`);
  assert(createParamCount === 16, `CREATE deveria declarar 16 parâmetros, contei ${createParamCount}`);
});

check("upload individual: document-upload-form.tsx AGORA também calcula e envia p_sha256_hash — correção real de uma lacuna de deduplicação (este formulário nunca hasheava, então nunca era protegido pelo índice único project_id+sha256_hash; 'Adicionar nova versão' e 'Upload individual (avançado)' usam este mesmo componente)", () => {
  const uploadForm = readSource("apps/web/components/documents/document-upload-form.tsx");
  assert(uploadForm.includes("computeFileSha256Hex"), "deveria importar/usar computeFileSha256Hex, mesma função do upload múltiplo");
  assert(uploadForm.includes("p_sha256_hash: sha256Hash"), "deveria passar o hash calculado para a RPC");
  assert(uploadForm.includes("DUPLICATE_FILE_HASH"), "deveria tratar o erro de duplicidade com mensagem clara, não crua");
  for (const param of ["p_project_id", "p_document_id", "p_document_version_id", "p_kind", "p_title", "p_version_label", "p_document_date", "p_source_type", "p_author", "p_summary", "p_file_path", "p_original_file_name", "p_mime_type", "p_file_size_bytes", "p_notes", "p_sha256_hash"]) {
    assert(uploadForm.includes(param), `upload individual deveria continuar passando ${param}`);
  }
});

// --- 5c. Deduplicação sob concorrência real ---
//
// Estes testes são ESTRUTURAIS (leitura do SQL da migration) — a
// migration não foi aplicada nesta etapa ("não aplique migration"),
// então não é possível abrir duas conexões reais e provocar a corrida
// de verdade aqui. O que se verifica é que a GARANTIA está no lugar
// certo (índice único do Postgres, não um SELECT aplicativo).

check("concorrência: existe um ÍNDICE ÚNICO real (project_id, sha256_hash) — a garantia não depende só do SELECT antecipado", () => {
  assert(
    /create unique index document_versions_project_hash_unique_idx\s*\n\s*on public\.document_versions \(project_id, sha256_hash\)\s*\n\s*where sha256_hash is not null;/.test(upgradeMigration),
    "índice único parcial (project_id, sha256_hash) ausente"
  );
});

check("concorrência: project_id de document_versions é SEMPRE calculado por trigger BEFORE INSERT, nunca aceito do chamador (nem desta RPC, nem de nenhum outro caminho de escrita)", () => {
  assert(/create trigger document_versions_set_project_id\s*\n\s*before insert or update of document_id on public\.document_versions/.test(upgradeMigration));
  const insertBlock = upgradeMigration.slice(
    upgradeMigration.indexOf("insert into public.document_versions ("),
    upgradeMigration.indexOf("exception\n    when unique_violation")
  );
  assert(!/\bproject_id\b/.test(insertBlock), "o INSERT da RPC não deveria listar project_id — isso é responsabilidade exclusiva do trigger");
});

check("concorrência: duas transações inserindo o MESMO hash no MESMO projeto — a RPC trata unique_violation daquele índice específico como DUPLICATE_FILE_HASH, e propaga qualquer outra violação sem mascarar", () => {
  const insertTryBlock = upgradeMigration.slice(
    upgradeMigration.indexOf("begin\n    insert into public.document_versions"),
    upgradeMigration.indexOf("-- ----------------------------------------------------------\n  -- Audit")
  );
  assert(/exception\s*\n\s*when unique_violation then/.test(insertTryBlock), "o INSERT deveria estar num bloco que capture unique_violation");
  assert(/get stacked diagnostics v_conflicting_constraint = constraint_name;/.test(insertTryBlock));
  assert(/v_conflicting_constraint = 'document_versions_project_hash_unique_idx'/.test(insertTryBlock), "só a violação DESTE índice deveria virar DUPLICATE_FILE_HASH");
  assert(/\n\s*raise;\s*\n\s*end;/.test(insertTryBlock), "qualquer outra unique_violation (ex.: version_label) deveria ser repropagada sem mascarar (RAISE simples)");
});

check("concorrência: trigger de project_id segue o mesmo padrão de search_path vazio das demais SECURITY DEFINER do projeto", () => {
  const triggerFnBlock = upgradeMigration.slice(
    upgradeMigration.indexOf("create or replace function public.set_document_version_project_id"),
    upgradeMigration.indexOf("create trigger document_versions_set_project_id")
  );
  assert(/security definer/.test(triggerFnBlock));
  assert(/set search_path = ''/.test(triggerFnBlock), "deveria usar search_path vazio, não 'public' — mesmo padrão hardened das outras functions");
});

// --- 5d. Trigger: BEFORE INSERT OR UPDATE OF document_id ---

check("trigger: dispara em INSERT e em UPDATE OF document_id — nunca confia em project_id herdado se o document_id de uma linha mudar", () => {
  assert(
    /before insert or update of document_id on public\.document_versions/.test(upgradeMigration),
    "trigger deveria disparar em BEFORE INSERT OR UPDATE OF document_id"
  );
});

check("trigger: sempre recalcula project_id a partir de documents.project_id (join pelo document_id atual, NEW), nunca aceita o valor já presente na linha", () => {
  const triggerFnBlock = upgradeMigration.slice(
    upgradeMigration.indexOf("create or replace function public.set_document_version_project_id"),
    upgradeMigration.indexOf("create trigger document_versions_set_project_id")
  );
  assert(/select d\.project_id into new\.project_id/.test(triggerFnBlock));
  assert(/from public\.documents d\s*\n\s*where d\.id = new\.document_id/.test(triggerFnBlock));
  assert(!/new\.project_id\s*:?=\s*[^n]/.test(triggerFnBlock.replace(/select d\.project_id into new\.project_id/, "")), "não deveria haver nenhuma outra atribuição a new.project_id além do SELECT derivado");
});

// --- 5e. Privilégios da RPC preservados após DROP+CREATE ---

check("privilégios: owner restaurado explicitamente (ALTER FUNCTION ... OWNER TO postgres, confirmado ao vivo antes da edição)", () => {
  assert(
    /alter function public\.register_project_document_upload\(\s*\n\s*uuid, uuid, uuid, text, text, text, date, text, text, text,\s*\n\s*text, text, text, bigint, text, text\s*\n\) owner to postgres;/.test(upgradeMigration),
    "ALTER FUNCTION ... OWNER TO postgres ausente"
  );
});

check("privilégios: PUBLIC e anon continuam SEM acesso (revoke all explícito após o DROP, que reabriria para PUBLIC por padrão)", () => {
  const grantsSection = upgradeMigration.slice(upgradeMigration.indexOf("-- Privilégios: restaura"));
  assert(/revoke all[\s\S]*?from public;/.test(grantsSection));
  assert(/revoke all[\s\S]*?from anon;/.test(grantsSection));
});

check("privilégios: authenticated E service_role recebem EXECUTE de volta — exatamente o mesmo par que a consulta ao vivo mostrou, nada a mais", () => {
  const grantsSection = upgradeMigration.slice(upgradeMigration.indexOf("-- Privilégios: restaura"));
  const grantMatches = grantsSection.match(/grant execute[\s\S]*?to (\w+);/g) ?? [];
  const grantees = grantMatches.map((m) => m.match(/to (\w+);/)[1]);
  assert(grantees.includes("authenticated"), "authenticated deveria continuar com EXECUTE");
  assert(grantees.includes("service_role"), "service_role deveria continuar com EXECUTE (estava na ACL ao vivo)");
  assert(!grantees.includes("anon"), "anon nunca deveria receber GRANT EXECUTE");
  assert(grantees.length === 2, `esperado só authenticated+service_role recebendo GRANT, encontrado: ${grantees.join(", ")}`);
});

check("privilégios: SECURITY DEFINER e search_path fixo continuam exatamente como estavam ao vivo (search_path=public, storage)", () => {
  assert(/security definer\s*\nset search_path = public, storage/.test(upgradeMigration));
});

check("privilégios: autorização de negócio (membership) continua sendo verificada dentro da function, independente do GRANT EXECUTE — usuário authenticated sem vínculo com o projeto continua bloqueado", () => {
  const fnBody = upgradeMigration.slice(
    upgradeMigration.indexOf("create or replace function public.register_project_document_upload(\n  p_project_id"),
    upgradeMigration.indexOf("-- Privilégios: restaura")
  );
  assert(/if not public\.can_manage_project_documents\(p_project_id\) then/.test(fnBody), "checagem de permissão por projeto ausente no corpo da function");
});

// --- 5f. Limpeza de Storage órfão ---

const { removeOrphanedStorageObject, buildReconciliationError } = await import(
  "../apps/web/lib/documents/multi-upload/storage-cleanup.ts"
);

await checkAsync("storage órfão: upload funcionou mas RPC falhou -> remove SÓ o objeto recém-enviado (o path da própria chamada, nunca outro)", async () => {
  const removedPaths = [];
  const fakeRemove = async (paths) => {
    removedPaths.push(...paths);
    return { error: null };
  };
  const result = await removeOrphanedStorageObject(fakeRemove, "proj-1/doc-1/version-abc/arquivo.pdf");
  assert(result.removed === true);
  assert(removedPaths.length === 1 && removedPaths[0] === "proj-1/doc-1/version-abc/arquivo.pdf", "deveria remover exatamente o path informado, nenhum outro");
});

await checkAsync("storage órfão: se a própria limpeza falhar (API retorna error, sem lançar), o resultado é reconciliationError explícito — nunca silencioso", async () => {
  const fakeRemoveWithApiError = async () => ({ error: { message: "network timeout" } });
  const result = await removeOrphanedStorageObject(fakeRemoveWithApiError, "proj-1/doc-1/version-xyz/arquivo.pdf");
  assert(result.removed === false);
  assert(result.reconciliationError !== null, "deveria haver uma mensagem de reconciliação, nunca null quando a limpeza falha");
  assert(/proj-1\/doc-1\/version-xyz\/arquivo\.pdf/.test(result.reconciliationError), "mensagem deveria citar o path exato do objeto órfão");
  assert(/[Rr]econcilia/.test(result.reconciliationError), "mensagem deveria indicar reconciliação explicitamente");
});

await checkAsync("storage órfão: se a chamada de remoção lançar (não só retornar {error}), também vira reconciliationError explícito, nunca é engolida", async () => {
  const fakeRemoveThatThrows = async () => {
    throw new Error("conexão perdida");
  };
  const result = await removeOrphanedStorageObject(fakeRemoveThatThrows, "proj-1/doc-1/version-thrown/arquivo.pdf");
  assert(result.removed === false);
  assert(/conexão perdida/.test(result.reconciliationError));
});

check("storage órfão: buildReconciliationError sempre menciona o path e pede reconciliação manual", () => {
  const msg = buildReconciliationError("a/b/c.pdf", "motivo x");
  assert(msg.includes("a/b/c.pdf"));
  assert(/reconcilia/i.test(msg));
});

check("storage órfão: o hook usa removeOrphanedStorageObject (não um .remove() cru sem checar o retorno) nos dois pontos de limpeza — falha no registro E exceção inesperada", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  const occurrences = hookSource.match(/removeOrphanedStorageObject\(/g) ?? [];
  assert(occurrences.length === 2, `esperado 2 usos de removeOrphanedStorageObject (branch de erro de registro + catch), encontrado ${occurrences.length}`);
  assert(!/\.remove\(\[uploadedPath\]\)/.test(hookSource), "não deveria mais existir uma chamada crua a .remove([uploadedPath]) sem checar o retorno");
});

check("storage órfão: nunca remove arquivo de versão já registrada — uploadedPath é zerado IMEDIATAMENTE após o registro ter sucesso, antes de qualquer código que possa lançar depois", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  const afterSuccessBlock = hookSource.slice(
    hookSource.indexOf("if (registerError) {"),
    hookSource.indexOf("documentVersionId,\n          progressPercent: progressForPhase(\"REGISTRO\"")
  );
  // depois do bloco "if (registerError) {...return;}", a primeiríssima
  // linha de código deveria ser a que zera uploadedPath
  const afterIfBlock = afterSuccessBlock.slice(afterSuccessBlock.lastIndexOf("return;\n        }"));
  assert(/uploadedPath = null;/.test(afterIfBlock), "uploadedPath deveria ser zerado logo após confirmar sucesso do registro");
});

check("storage órfão: retry nunca reaproveita um path de tentativa anterior — cada chamada de continueAfterDecision gera documentVersionId novo (crypto.randomUUID), então nunca acumula sobre o MESMO path", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  const continueAfterDecisionBody = hookSource.slice(
    hookSource.indexOf("const continueAfterDecision = useCallback("),
    hookSource.indexOf("const processItem = useCallback(")
  );
  assert(/const documentVersionId = crypto\.randomUUID\(\);/.test(continueAfterDecisionBody), "documentVersionId deveria ser gerado do zero a cada chamada (cada retry chama de novo)");
  assert(/retryItem/.test(hookSource) && /status: "PENDENTE"/.test(hookSource), "retryItem deveria voltar o item para PENDENTE, reentrando no pipeline do zero (nova tentativa = novo path)");
});

// --- 6. Atas de Reunião ---

check("ata de reunião: entra no pipeline documental normal (mesma RPC, mesmo bucket) — nenhum caminho especial/paralelo", () => {
  const migration = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(migration.includes("'ATA_REUNIAO'"), "ATA_REUNIAO deveria ser um kind válido, não um fluxo separado");
});

check("ata de reunião: requires_human_review é calculado no SERVIDOR a partir do kind, nunca aceito como parâmetro do cliente", () => {
  const migration = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(/v_requires_human_review := \(p_kind = 'ATA_REUNIAO'\)/.test(migration), "cálculo server-side ausente ou alterado");
  assert(!/p_requires_human_review/.test(migration), "não deveria existir um parâmetro de entrada para isso — abriria brecha para o cliente mentir");
});

check("ata de reunião: nunca finge processamento concluído — nenhum worker de OCR/extração real existe nesta etapa", () => {
  assert(
    !fileExists("apps/web/lib/documents/ocr.ts") &&
    !fileExists("apps/web/lib/documents/extract-meeting-minutes.ts"),
    "não deveria existir um extrator real fingido nesta etapa"
  );
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  assert(
    /não está implementada nesta etapa/.test(hookSource),
    "a pendência de extração deveria ser informada claramente, nunca escondida"
  );
  assert(!/PROCESSED/.test(hookSource), "o hook do upload múltiplo nunca deveria marcar PROCESSED sozinho (nenhum worker real existe)");
});

check("ata de reunião: termina em status terminal PRÓPRIO (AGUARDANDO_ANALISE), nunca reaproveitando CONCLUIDO — upload pode chegar a 100%, análise não", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  assert(
    /status: requiresHumanReview \? "AGUARDANDO_ANALISE" : "CONCLUIDO"/.test(hookSource),
    "Ata de Reunião deveria terminar em AGUARDANDO_ANALISE, documentos normais em CONCLUIDO"
  );
  assert(/progressPercent: 100/.test(hookSource), "o progresso do UPLOAD ainda pode chegar a 100%, mesmo para Ata");
  assert(/Upload concluído — análise\/OCR pendente/.test(hookSource), "mensagem exata exigida ausente");

  const typesSource = readSource("apps/web/lib/documents/multi-upload/types.ts");
  assert(/"AGUARDANDO_ANALISE"/.test(typesSource), "status novo ausente do tipo QueueItemStatus");

  const statusLabelsSource = readSource("apps/web/components/documents/multi-upload/status-labels.ts");
  assert(
    /AGUARDANDO_ANALISE: "Upload concluído — análise\/OCR pendente"/.test(statusLabelsSource),
    "rótulo do status novo ausente/diferente do exigido"
  );
});

function fileExists(relativePath) {
  try {
    readSource(relativePath);
    return true;
  } catch {
    return false;
  }
}

check("ata de reunião: badge de revisão humana necessária aparece também na listagem principal de Documentos (não só durante o upload)", () => {
  const pageSource = readSource("apps/web/app/[projectId]/documentos/page.tsx");
  // O cartão de cada documento (com o badge de revisão humana) foi
  // extraído para DocumentCard (reaproveitado pelos grupos contratuais
  // e pela lista sem vínculo) — page.tsx renderiza a listagem através
  // dele, não mais inline.
  assert(pageSource.includes("DocumentCard"), "page.tsx deveria renderizar a listagem principal via DocumentCard");
  const documentCardSource = readSource("apps/web/components/documents/document-card.tsx");
  assert(/requiresHumanReview/.test(documentCardSource));
  assert(/Revisão humana necessária/.test(documentCardSource));
});

// --- 7. Erros específicos ---

check("erros: mensagens específicas, nunca 'Erro desconhecido' quando a causa é conhecida", () => {
  const msg1 = buildImportErrorMessage("Contrato XYZ.pdf", "arquivo duplicado");
  assert(msg1 === "Contrato XYZ.pdf não foi importado: arquivo duplicado.", msg1);

  const msg2 = buildImportErrorMessage("Ata 25-08.pdf", "formato inválido");
  assert(msg2 === "Ata 25-08.pdf não foi importado: formato inválido.", msg2);

  const msg3 = buildImportErrorMessage("Cronograma.xlsx", "falha no armazenamento");
  assert(msg3 === "Cronograma.xlsx não foi importado: falha no armazenamento.", msg3);
});

check("erros: nenhum arquivo novo usa a string genérica 'Erro desconhecido'", () => {
  for (const file of [
    "apps/web/components/documents/multi-upload/use-document-upload-queue.ts",
    "apps/web/lib/documents/multi-upload/queue-core.ts",
  ]) {
    assert(!readSource(file).includes("Erro desconhecido"), `${file} não deveria usar mensagem genérica`);
  }
});

// --- 8. Segurança ---

check("segurança: RPC exige can_manage_project_documents (ADMINISTRADOR ou GESTOR) — não mais has_project_permission('ADMINISTRADOR')", () => {
  const migration = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(/if not public\.can_manage_project_documents\(p_project_id\) then/.test(migration));
});

// --- 8b. Decisão de negócio: upload permitido para ADMINISTRADOR e
// GESTOR (não mais só ADMINISTRADOR), via um helper NOVO e ISOLADO
// (can_manage_project_documents) — has_project_permission (a
// hierarquia GLOBAL) não foi tocada, confirmado abaixo lendo a
// implementação viva de novo.

const liveHasProjectPermission = readSource(
  "supabase/migrations/20260824232516_enforce_admin_only_write.sql"
);
const canManageMigration = readSource(
  "supabase/migrations/20260825130000_multi_document_upload_foundation.sql"
);

// Espelho fiel da regra de negócio de can_manage_project_documents —
// IN-list explícita, não hierarquia por nível.
const DOCUMENT_UPLOAD_ROLES = ["ADMINISTRADOR", "GESTOR"];

function canManageProjectDocuments(callerPermission, callerStatus) {
  if (callerStatus !== "ACTIVE") return false;
  return DOCUMENT_UPLOAD_ROLES.includes(callerPermission);
}

check("has_project_permission (hierarquia GLOBAL) não foi alterada — continua ADMINISTRADOR=3, GESTOR/COLABORADOR/LEITURA=1, intocada por esta migration", () => {
  assert(
    !readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql").includes("has_project_permission("),
    "esta migration não deveria mais chamar has_project_permission em lugar nenhum — nem no upload nem na promoção de anexo"
  );
  assert(/when 'ADMINISTRADOR' then 3/.test(liveHasProjectPermission));
  assert(/when 'GESTOR' then 1/.test(liveHasProjectPermission));
});

check("can_manage_project_documents: IN-list explícita (ADMINISTRADOR, GESTOR), não uma reinterpretação da hierarquia global", () => {
  assert(
    /and pm\.permission in \('ADMINISTRADOR', 'GESTOR'\)/.test(canManageMigration),
    "helper novo deveria comparar por IN-list explícita, não por nível"
  );
  assert(/and pm\.status = 'ACTIVE'/.test(canManageMigration), "status ACTIVE continua exigido dentro do helper");
});

check("papel ADMINISTRADOR ativo: PODE fazer upload", () => {
  assert(canManageProjectDocuments("ADMINISTRADOR", "ACTIVE") === true);
});

check("papel GESTOR ativo: PODE fazer upload — decisão de negócio desta etapa, isolada da hierarquia global (que continua tratando GESTOR como somente leitura para todo o resto do sistema)", () => {
  assert(canManageProjectDocuments("GESTOR", "ACTIVE") === true);
});

check("papel COLABORADOR ativo: NÃO pode fazer upload", () => {
  assert(canManageProjectDocuments("COLABORADOR", "ACTIVE") === false);
});

check("papel LEITURA ativo: NÃO pode fazer upload", () => {
  assert(canManageProjectDocuments("LEITURA", "ACTIVE") === false);
});

check("GESTOR inativo (membership INACTIVE): NÃO pode fazer upload — status é checado independentemente do papel", () => {
  assert(canManageProjectDocuments("GESTOR", "INACTIVE") === false);
});

check("usuário sem membership (nenhuma linha em project_memberships para este projeto): NÃO pode fazer upload — o EXISTS de can_manage_project_documents não encontra nenhuma linha, retorna false", () => {
  assert(canManageProjectDocuments(undefined, "ACTIVE") === false, "permission indefinida (nenhuma membership) nunca deveria satisfazer o IN-list");
});

check("upload individual E upload múltiplo usam a MESMA checagem — register_project_document_upload é a única RPC de ambos os fluxos (unificados desde o começo desta feature)", () => {
  assert(
    (canManageMigration.match(/if not public\.can_manage_project_documents\(p_project_id\) then/g) ?? []).length === 1,
    "só deveria haver 1 checagem dentro de register_project_document_upload — upload individual e múltiplo chamam a mesma function"
  );
  const uploadForm = readSource("apps/web/components/documents/document-upload-form.tsx");
  assert(uploadForm.includes('supabase.rpc("register_project_document_upload"') || uploadForm.includes(".rpc(\n"), "upload individual deveria continuar chamando a mesma RPC");
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  assert(hookSource.includes('.rpc("register_project_document_upload"'), "upload múltiplo deveria continuar chamando a mesma RPC");
});

check("promote_email_attachment_to_document (também cria document/version) alinhado para ADMINISTRADOR ou GESTOR, mesma decisão — CREATE OR REPLACE de mesma assinatura, migration histórica não tocada", () => {
  const historicalMigration = readSource("supabase/migrations/20260823100000_promote_email_attachment_to_document.sql");
  assert(
    /has_project_permission\(v_attachment\.project_id, 'EDITOR'\)/.test(historicalMigration),
    "a migration histórica (já aplicada) não deveria ter sido editada — continua com o literal EDITOR original"
  );

  assert(
    /create or replace function public\.promote_email_attachment_to_document\(/.test(canManageMigration),
    "nova migration deveria conter um CREATE OR REPLACE de promote_email_attachment_to_document"
  );
  const overrideBody = canManageMigration.slice(
    canManageMigration.lastIndexOf("create or replace function public.promote_email_attachment_to_document(")
  );
  assert(
    /if not public\.can_manage_project_documents\(v_attachment\.project_id\) then/.test(overrideBody),
    "override deveria usar can_manage_project_documents, igual ao upload de documentos"
  );
  assert(!/has_project_permission/.test(overrideBody), "override não deveria mais chamar has_project_permission");

  // Mesma assinatura da migration histórica -> Postgres troca só o
  // corpo, ACL/owner preservados automaticamente (nenhum DROP aqui).
  assert(!/drop function if exists public\.promote_email_attachment_to_document/.test(canManageMigration), "não deveria haver DROP — a assinatura não mudou, então não há risco de sobrecarga ambígua a resolver");
});

check("não amplia outras operações administrativas: nenhuma outra function desta migration passou a usar can_manage_project_documents além das duas de Documentos", () => {
  const occurrences = canManageMigration.match(/public\.can_manage_project_documents\(/g) ?? [];
  // 1 na definição (chamada não conta) + 1 em register_project_document_upload + 1 em promote_email_attachment_to_document + comentários não contam pois usamos regex sem \b em comentário também — checamos por contagem mínima esperada via função, não por igualdade estrita de comentários.
  const callSites = canManageMigration.match(/if not public\.can_manage_project_documents\(/g) ?? [];
  assert(callSites.length === 2, `esperado exatamente 2 pontos de chamada (upload de documentos + promoção de anexo), encontrado ${callSites.length}`);
  assert(occurrences.length >= callSites.length, "sanity");
});

check("nenhum literal obsoleto (ADMIN/EDITOR/VIEWER) permanece em SQL executável desta migration — só em comentários explicando o histórico", () => {
  const codeLines = canManageMigration
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"));
  const codeOnly = codeLines.join("\n");
  assert(!/'ADMIN'|'EDITOR'|'VIEWER'/.test(codeOnly), `literal obsoleto encontrado fora de comentário: ${(codeOnly.match(/.{0,40}'(ADMIN|EDITOR|VIEWER)'.{0,10}/) || [""])[0]}`);
});

check("segurança: só usuário autorizado (ADMINISTRADOR ou GESTOR) vê o painel de upload — canUpload continua controlando o render, nunca é a proteção definitiva (a RPC revalida tudo de novo)", () => {
  const pageSource = readSource("apps/web/app/[projectId]/documentos/page.tsx");
  assert(/canUpload \? \(/.test(pageSource) && /DocumentMultiUploadPanel/.test(pageSource));
  const idx = pageSource.indexOf("canUpload ? (");
  const multiIdx = pageSource.lastIndexOf("DocumentMultiUploadPanel"); // última ocorrência = uso em JSX, não o import
  assert(idx !== -1 && multiIdx > idx, "o painel novo deveria estar dentro do bloco condicionado a canUpload");

  const canUploadLine = pageSource.slice(pageSource.indexOf("const canUpload ="), pageSource.indexOf("const canUpload =") + 200);
  assert(/permission === "ADMINISTRADOR" \|\| permission === "GESTOR"/.test(canUploadLine), "canUpload deveria permitir ADMINISTRADOR OU GESTOR");
});

check("segurança: servidor revalida tudo de novo — tamanho, kind, source_type e hash são checados na RPC, nunca só no navegador", () => {
  const migration = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(/File size must be between 1 byte and 50 MiB/.test(migration));
  assert(/Invalid document kind/.test(migration));
  assert(/Invalid source type/.test(migration));
  assert(/Invalid file hash/.test(migration));
});

check("segurança: extensão/MIME validados no cliente (validateDescriptor) E o bucket mantém allowed_mime_types/file_size_limit no servidor", () => {
  assert(validateDescriptor(buildDescriptor("virus.exe", 1000)).ok === false, "extensão não permitida deveria ser rejeitada");
  assert(validateDescriptor(buildDescriptor("contrato.pdf", 1000)).ok === true, "PDF permitido deveria passar");
  const foundationMigration = readSource("supabase/migrations/20260821004108_project_document_upload_foundation.sql");
  assert(/allowed_mime_types/.test(foundationMigration), "bucket deveria continuar restringindo MIME no servidor (migration original, não tocada)");
});

check("segurança: nomes são sanitizados para o caminho de Storage (sem acentos/espaços/caracteres especiais)", () => {
  assert(sanitizeFileName("Ata de Reunião nº 3 (final).pdf") === "Ata-de-Reuniao-n-3-final.pdf" || /^[a-zA-Z0-9._-]+$/.test(sanitizeFileName("Ata de Reunião nº 3 (final).pdf")));
});

check("segurança: nenhum arquivo novo cria/expõe signed URL de Storage", () => {
  for (const file of [
    "apps/web/components/documents/multi-upload/use-document-upload-queue.ts",
    "apps/web/components/documents/multi-upload/document-multi-upload-panel.tsx",
  ]) {
    assert(!/createSignedUrl/.test(readSource(file)), `${file} não deveria expor URL assinada`);
  }
});

check("segurança: auditoria continua sendo registrada no registro do documento (audit_log_entries, PROJECT_DOCUMENT_UPLOADED/VERSION)", () => {
  const migration = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(/insert into public\.audit_log_entries/.test(migration));
  assert(/PROJECT_DOCUMENT_UPLOADED/.test(migration) && /PROJECT_DOCUMENT_VERSION_UPLOADED/.test(migration));
});

check("segurança: RPC estendida por CREATE OR REPLACE (nunca edita migration histórica já aplicada)", () => {
  const migration = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(/create or replace function public\.register_project_document_upload/.test(migration));
  const historical = readSource("supabase/migrations/20260821004108_project_document_upload_foundation.sql");
  assert(historical.includes("create or replace function public.register_project_document_upload"), "migration histórica não deveria ter sido tocada");
});

check("segurança: novos parâmetros da RPC vêm no final com default — retrocompatível (chamadas antigas sem p_sha256_hash continuariam válidas), e o upload individual agora OPTA por enviá-lo deliberadamente (fechando a lacuna de deduplicação, ver checagem dedicada acima)", () => {
  const migration = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(/p_notes text default null,\s*\n\s*p_sha256_hash text default null/.test(migration), "p_sha256_hash deveria ser o último parâmetro, com default (retrocompatibilidade)");
});

// --- Limite de tamanho ---

check("limite de tamanho: arquivo de exatamente 50 MB passa, 50 MB + 1 byte é rejeitado", () => {
  const atLimit = buildDescriptor("planilha.xlsx", MAX_FILE_SIZE_BYTES);
  const overLimit = buildDescriptor("planilha.xlsx", MAX_FILE_SIZE_BYTES + 1);
  assert(validateDescriptor(atLimit).ok === true, "exatamente no limite deveria passar");
  assert(validateDescriptor(overLimit).ok === false, "acima do limite deveria ser rejeitado");
});

check("limite de tamanho: arquivo vazio (0 bytes) é rejeitado", () => {
  assert(validateDescriptor(buildDescriptor("vazio.pdf", 0)).ok === false);
});

// --- Arquivo inválido ---

check("arquivo inválido: extensão fora da allowlist é rejeitada com motivo específico", () => {
  const result = validateDescriptor(buildDescriptor("script.exe", 1000));
  assert(result.ok === false);
  assert(/formato/i.test(result.reason));
});

check("arquivo inválido: todas as extensões da allowlist resolvem um MIME conhecido", () => {
  for (const ext of Object.keys(MIME_BY_EXTENSION)) {
    assert(resolveMimeType(`arquivo.${ext}`) !== null, `extensão deveria ser aceita: ${ext}`);
  }
});

// ---------- 5. Suporte a Microsoft Project (.mpp) ----------

check(".mpp: extensão aceita, resolve o MIME canônico application/vnd.ms-project — nunca o file.type bruto do navegador (resolveMimeType só olha a extensão, ignora file.type por construção — tolera qualquer variante que o navegador reporte, incluindo application/x-msproject/application/octet-stream/vazio)", () => {
  assert(resolveMimeType("Cronograma Obra.mpp") === "application/vnd.ms-project");
  assert(ACCEPT_ATTRIBUTE.includes(".mpp"), "o atributo accept do <input type=file> deveria incluir .mpp");
});

check(".mpp: sempre classificado automaticamente como CRONOGRAMA_BASELINE — o tipo canônico de cronograma nesta base (não existe um valor solto 'CRONOGRAMA' em DocumentKind); nunca CONTRATO/CONTRATO_BASE", () => {
  const descriptor = buildDescriptor("Cronograma Obra.mpp", 12345);
  assert(isMppFile(descriptor) === true);
  assert(suggestedKindForDescriptor(descriptor) === "CRONOGRAMA_BASELINE");
});

check(".mpp: comparação de extensão é case-insensitive (.MPP, .Mpp) — mesma resolução de MIME e sugestão de tipo", () => {
  for (const name of ["Cronograma.MPP", "Cronograma.Mpp", "cronograma.mpp"]) {
    const descriptor = buildDescriptor(name, 100);
    assert(isMppFile(descriptor) === true, `${name} deveria ser reconhecido como .mpp`);
    assert(suggestedKindForDescriptor(descriptor) === "CRONOGRAMA_BASELINE");
  }
});

check("não-.mpp nunca recebe sugestão automática de tipo — nenhum outro formato (PDF incluso) é classificado só pelo nome/extensão, mesmo quando o nome sugere um tipo específico", () => {
  for (const name of ["Contrato Base.pdf", "Cronograma.xlsx", "Relatorio Semanal.docx", "Planilha.csv"]) {
    assert(suggestedKindForDescriptor(buildDescriptor(name, 100)) === null, `${name} não deveria ter sugestão automática`);
  }
});

check(".mpp: nunca processado como PDF — nenhum caminho de código trata .mpp como PDF (grep estrutural no hook e no formulário individual)", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  const formSource = readSource("apps/web/components/documents/document-upload-form.tsx");
  assert(!/mpp[\s\S]{0,80}pdf/i.test(hookSource), "hook não deveria ter nenhuma lógica associando .mpp a processamento de PDF");
  assert(!/mpp[\s\S]{0,80}pdf/i.test(formSource), "formulário individual não deveria ter nenhuma lógica associando .mpp a processamento de PDF");
});

check(".mpp: nunca afirma que o cronograma foi extraído — usa a mensagem clara 'Arquivo MPP armazenado — extração ainda não realizada' (status CONCLUIDO, não um status de erro/pendência)", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  assert(hookSource.includes("Arquivo MPP armazenado — extração ainda não realizada."));
  assert(hookSource.includes("isMppFile(current.descriptor)"), "a mensagem deveria ser condicionada a isMppFile, não a uma heurística de nome");
});

check("classifyStorageUploadError: diferencia causas conhecidas (MIME recusado/tamanho/permissão/nome duplicado) sem nunca vazar detalhes internos crus — cai para a mensagem genérica só quando não reconhece a causa", () => {
  assert(classifyStorageUploadError("The object exceeded the maximum allowed size") === "arquivo excede o tamanho máximo permitido pelo armazenamento");
  assert(classifyStorageUploadError("mime type application/x-foo is not supported") === "tipo de arquivo não permitido pelo armazenamento");
  assert(classifyStorageUploadError("The resource already exists") === "conflito de nome no armazenamento");
  assert(classifyStorageUploadError("permission denied for this operation") === "sem permissão para gravar no armazenamento");
  assert(classifyStorageUploadError("connection reset") === "falha no armazenamento");
  assert(classifyStorageUploadError(null) === "falha no armazenamento");
  assert(classifyStorageUploadError(undefined) === "falha no armazenamento");
});

check("falha de Storage: a mensagem/statusCode técnicos originais são sempre logados internamente (console.error), nunca descartados — só a frase exposta ao usuário é que é filtrada/segura", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  assert(/console\.error\(\s*"\[multi-upload\] falha no Storage:"/.test(hookSource), "deveria logar a causa técnica original do erro de Storage");
  assert(hookSource.includes("classifyStorageUploadError(uploadError.message)"), "a mensagem exposta ao usuário deveria vir de classifyStorageUploadError, nunca do texto cru");
});

// ---------- 6. Seleção de tipo documental obrigatória (sem default CONTRATO_BASE) ----------

check("MultiUploadDocumentKind: \"\" (não selecionado) é um valor válido do tipo — batchDefaultKind e o kind inicial de cada item nunca mais começam em CONTRATO_BASE", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  assert(!/useState<MultiUploadDocumentKind>\("CONTRATO_BASE"\)/.test(hookSource), "batchDefaultKind não deveria mais iniciar em CONTRATO_BASE");
  assert(/useState<MultiUploadDocumentKind>\(""\)/.test(hookSource), "batchDefaultKind deveria iniciar em \"\" (nada selecionado)");
});

check("document-upload-form.tsx (upload individual): seletor de tipo documental também não usa mais defaultValue=CONTRATO_BASE — mostra 'Selecione o tipo documental' e é required", () => {
  const formSource = readSource("apps/web/components/documents/document-upload-form.tsx");
  assert(!formSource.includes('defaultValue="CONTRATO_BASE"'), "formulário individual não deveria mais ter defaultValue=CONTRATO_BASE");
  assert(formSource.includes("Selecione o tipo documental"));
  assert(/name="kind"\s*\n\s*required/.test(formSource), "o campo kind continua required (bloqueio nativo HTML5 quando vazio)");
});

check("processItem: item sem tipo documental selecionado (kind === \"\") é REJEITADO com mensagem clara ANTES do hash/upload — nunca envia/infere um tipo às cegas", () => {
  const hookSource = readSource("apps/web/components/documents/multi-upload/use-document-upload-queue.ts");
  const processItemBody = hookSource.slice(hookSource.indexOf("const processItem = useCallback("), hookSource.indexOf("const tick = useCallback("));
  assert(/if \(!current\.kind\) \{/.test(processItemBody), "processItem deveria recusar itens sem kind selecionado");
  assert(/status: "REJEITADO"/.test(processItemBody.slice(processItemBody.indexOf("if (!current.kind)"), processItemBody.indexOf("if (!current.kind)") + 300)));
  const kindCheckIndex = processItemBody.indexOf("if (!current.kind)");
  const hashIndex = processItemBody.indexOf('status: "CALCULANDO_HASH"');
  assert(kindCheckIndex !== -1 && hashIndex !== -1 && kindCheckIndex < hashIndex, "a checagem de kind deveria acontecer ANTES da fase de hash/upload");
});

check("queue-item-row.tsx: seletor de tipo documental do item mostra o placeholder 'Selecione o tipo documental' e fica bloqueado (não editável) especificamente para arquivos .mpp — nenhum outro tipo de arquivo é bloqueado", () => {
  const rowSource = readSource("apps/web/components/documents/multi-upload/queue-item-row.tsx");
  assert(rowSource.includes("Selecione o tipo documental"));
  assert(rowSource.includes("!isMppFile(item.descriptor)"), "canEditKind deveria excluir arquivos .mpp");
});

check("retry somente de erros: RETRYABLE_STATUSES contém exatamente {ERRO} — DUPLICADO/REJEITADO/CONCLUIDO/AGUARDANDO_ANALISE nunca mostram o botão 'Tentar novamente' (retry nunca reenvia duplicados nem itens já concluídos)", () => {
  const rowSource = readSource("apps/web/components/documents/multi-upload/queue-item-row.tsx");
  const match = rowSource.match(/const RETRYABLE_STATUSES = new Set\(\[([^\]]*)\]\);/);
  assert(match, "RETRYABLE_STATUSES não encontrado");
  const statuses = match[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
  assert(statuses.length === 1 && statuses[0] === "ERRO", `RETRYABLE_STATUSES deveria ser exatamente ["ERRO"], encontrado ${JSON.stringify(statuses)}`);
});

// ---------- Deduplicação da LISTAGEM (não só do novo upload) ----------
//
// getManagedDocuments (a query real por trás da aba Documentos) exige
// createSupabaseServerClient() — não é possível chamá-la de verdade
// aqui sem banco. As checagens abaixo comprovam a garantia pelo
// SCHEMA/migration e pela leitura estrutural do próprio mapper — nunca
// consultando o banco remoto.

const documentManagementSource = readSource("apps/web/lib/document-management.ts");

check("dedup da listagem: getManagedDocuments busca documents SEMPRE escopado por project_id (.eq) — um documento de outro projeto nunca entra nem chega a ser considerado para deduplicação", () => {
  assert(/\.from\("documents"\)[\s\S]{0,80}\.eq\("project_id", projectId\)/.test(documentManagementSource), "query de documents deveria ser escopada por project_id");
});

check("dedup da listagem: getManagedDocuments NUNCA agrupa/filtra por title — cada linha de documents vira um card, cada linha de document_versions vira uma versão dentro do card do seu document_id; nenhuma lógica de deduplicação por nome existe no mapper", () => {
  assert(!/\btitle\b[\s\S]{0,40}(group|dedupe|dedup|distinct|Set\()/i.test(documentManagementSource), "não deveria haver nenhuma lógica de agrupamento/dedup por título");
  assert(!documentManagementSource.includes(".delete("), "o mapper de listagem nunca deveria apagar registros");
});

check("dedup da listagem: garantia REAL contra duplicidade histórica é o índice único parcial (project_id, sha256_hash) WHERE sha256_hash IS NOT NULL — documents_versions com hash idêntico no MESMO projeto são estruturalmente impossíveis de coexistir a partir desta migration; a exclusão explícita de sha256_hash NULL é intencional (versões antigas sem hash não são afetadas por este índice)", () => {
  const migration = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(
    /create unique index document_versions_project_hash_unique_idx\s*\n\s*on public\.document_versions \(project_id, sha256_hash\)\s*\n\s*where sha256_hash is not null;/.test(migration),
    "índice único parcial (project_id, sha256_hash) WHERE sha256_hash IS NOT NULL não encontrado exatamente como esperado"
  );
});

check("dedup da listagem: mesmo hash em PROJETOS DIFERENTES nunca é restringido pelo índice (chave composta inclui project_id) — permanece isolado por design, nunca deduplicado entre projetos", () => {
  const migration = readSource("supabase/migrations/20260825130000_multi_document_upload_foundation.sql");
  assert(/on public\.document_versions \(project_id, sha256_hash\)/.test(migration), "o índice deveria ser composto por (project_id, sha256_hash), nunca só (sha256_hash)");
});

check("dedup da listagem: card = 1 por DOCUMENTO (não por versão) — contador/estado vazio da página usam documents.length, a mesma coleção deduplicada por construção (uma linha = um id de documento distinto); versões do mesmo documento aparecem dentro do MESMO card, nunca como cards repetidos", () => {
  const pageSource = readSource("apps/web/app/[projectId]/documentos/page.tsx");
  assert(pageSource.includes("documents.length === 0"), "estado vazio deveria usar documents.length");
  // Desde os GRUPOS CONTRATUAIS (Contrato-base/Aditivo N + anexos), a
  // página não itera mais direto sobre documents.map — passa a coleção
  // inteira (sem filtrar/agrupar por título) para
  // groupDocumentsByContractualStructure, cujo próprio contrato
  // (testado exaustivamente em test-group-contractual-documents.mjs)
  // garante que cada documento de entrada aparece exatamente uma vez
  // na saída (groups + ungrouped) — nunca duplicado, nunca mesclado por
  // título. Cada card em si (DocumentCard/ContractualAttachmentRow)
  // continua vindo de um único ManagedDocument, um card por documento.
  assert(pageSource.includes("groupDocumentsByContractualStructure(documents)"), "a página deveria passar a coleção inteira de documents (sem pré-filtro) para o agrupador central");
  const groupingSource = readSource("apps/web/lib/documents/group-contractual-documents.ts");
  assert(!/\btitle\b/i.test(groupingSource), "o agrupador central não deveria basear nada em título — só id/kind/createdAt/parentDocumentId");
});

console.log("");
console.log("======================================");
console.log("LIMITAÇÃO CONHECIDA (reportada, não corrigida nesta rodada): o índice único é PARCIAL");
console.log("(WHERE sha256_hash IS NOT NULL) — versões com sha256_hash NULL (ex.: enviadas pelo upload");
console.log("individual ANTES da correção desta sessão, quando esse formulário nunca calculava hash)");
console.log("não são cobertas pela garantia de unicidade. Não foi consultado o banco remoto para");
console.log("confirmar se duplicatas históricas com hash NULL já existem — isso exigiria acesso ao");
console.log("banco remoto, fora do escopo autorizado nesta rodada.");
console.log("======================================");
console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
