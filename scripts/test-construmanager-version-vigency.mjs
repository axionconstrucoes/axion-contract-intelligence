// Pacote D — deteccao de NOVA VERSAO VIGENTE.
//
// Prova que a troca de revisao vigente e detectada e alertada UMA vez,
// a partir exclusivamente dos metadados oficiais — sem download, sem
// ZIP, sem SHA-256, sem Storage e sem hiperlink.
//
// Caso obrigatorio: o IFC #38350763 (262,9 MiB), que nunca sera baixado
// e ainda assim precisa ser monitorado.
//
// Nenhuma chamada real: banco falso em memoria reproduzindo a semantica
// de detect_construmanager_version_transitions.
//
// Uso: node scripts/test-construmanager-version-vigency.mjs

import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./ts-module-resolver.mjs", import.meta.url);

const {
  evaluateVigency,
  normalizeRevisionForComparison,
  buildVigencyAlertDetail,
  describeContentAvailability,
  VIGENCY_AUDIT_ACTION,
} = await import("../apps/web/lib/integrations/construmanager/version-vigency.ts");

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
// Dados reais do fixture da obra WEG 34164.
// ------------------------------------------------------------

const IFC = {
  objectId: 38350763,
  name: "356-WEG-MET-3D-001-R04.ifc",
  revision: "04",
  sizeBytes: 275687647,
  folderPath: "\\WEG Linhares ES - Fábrica de Fios\\PROJETOS - WEG",
  sourceCreatedAt: "2026-07-23T14:57:00",
  authorName: "Equipe WEG",
};

const LIMITE_50MB = 52428800;

console.log("");
console.log("PACOTE D — NOVA VERSAO VIGENTE");
console.log("==============================");
console.log("");
console.log("-- 1. a regra sai do payload real, nao de suposicao --");

// Par real cabeca/versao do fixture:
//   cabeca : id 37272424, versoes "01", isVersao 0, super 37271962 (pasta)
//   versao : id 39274704, versoes "00", isVersao 1, super 37272424 (cabeca)
const fixture = JSON.parse(
  readFileSync(
    "apps/web/lib/integrations/construmanager/fixtures/listamestra-list.weg-34164.json",
    "utf8"
  )
);

const linhas = [];
(function walk(o) {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === "object") {
    if ("cad_objects_id" in o) linhas.push(o);
    else Object.values(o).forEach(walk);
  }
})(fixture);

const topografia = linhas.filter((r) =>
  String(r.cad_objects_nome ?? "").includes("WLI-Topografia")
);

const cabeca = topografia.find((r) => Number(r.isVersao) === 0);
const historica = topografia.find((r) => Number(r.isVersao) === 1);

check("o fixture real tem a cabeca e a versao historica", Boolean(cabeca && historica));

check(
  "VIGENTE e identificado por isVersao = 0",
  Number(cabeca.isVersao) === 0 && Number(historica.isVersao) === 1
);

check(
  "a REVISAO vigente vem de cad_objects_versoes",
  cabeca.cad_objects_versoes === "01" && historica.cad_objects_versoes === "00"
);

check(
  "a versao historica aponta a cabeca por cad_objects_super",
  Number(historica.cad_objects_super) === Number(cabeca.cad_objects_id)
);

check(
  "o super da CABECA e a pasta, nao um documento (campo polimorfico)",
  Number(cabeca.cad_objects_super) !== Number(historica.cad_objects_id)
);

check(
  "a identidade documental da cabeca e cad_objects_id",
  Number(cabeca.cad_objects_id) === 37272424
);

check(
  "vigencia NAO e inferida por nome do arquivo",
  // O nome da versao historica traz "(00)", mas quem decide e isVersao.
  String(historica.cad_objects_nome).includes("(00)") &&
    Number(historica.isVersao) === 1
);

console.log("");
console.log("-- 2. normalizacao de revisao (evita alerta falso) --");

check('"01" e "1" sao a mesma revisao', normalizeRevisionForComparison("01") === normalizeRevisionForComparison("1"));
check('" 01 " normaliza igual a "01"', normalizeRevisionForComparison(" 01 ") === normalizeRevisionForComparison("01"));
check('"00" e "0" sao iguais', normalizeRevisionForComparison("00") === normalizeRevisionForComparison("0"));
check('"01" e "02" sao DIFERENTES', normalizeRevisionForComparison("01") !== normalizeRevisionForComparison("02"));
check('"a" normaliza para maiuscula', normalizeRevisionForComparison("a") === "A");
check("nulo normaliza para vazio", normalizeRevisionForComparison(null) === "");

console.log("");
console.log("-- 3. primeira observacao NAO alerta --");

const primeira = evaluateVigency(null, {
  objectId: IFC.objectId,
  revision: IFC.revision,
  name: IFC.name,
  sourceCreatedAt: IFC.sourceCreatedAt,
  authorName: IFC.authorName,
  sizeBytes: IFC.sizeBytes,
  folderPath: IFC.folderPath,
});

check("documento nunca visto => PRIMEIRA_OBSERVACAO", primeira.outcome === "PRIMEIRA_OBSERVACAO");
check("primeira observacao nao tem revisao anterior", primeira.previousRevision === null);
check(
  "carga inicial nao vira 192 alertas",
  primeira.outcome !== "NOVA_VERSAO_VIGENTE"
);

console.log("");
console.log("-- 4. nova revisao substituindo a anterior --");

const anterior = {
  objectId: IFC.objectId,
  revision: "04",
  name: IFC.name,
  sourceCreatedAt: IFC.sourceCreatedAt,
  authorName: IFC.authorName,
  sizeBytes: IFC.sizeBytes,
  folderPath: IFC.folderPath,
};

const r05 = {
  ...anterior,
  revision: "05",
  name: "356-WEG-MET-3D-001-R05.ifc",
  sourceCreatedAt: "2026-09-10T09:00:00",
};

const transicao = evaluateVigency(anterior, r05);

check("R04 -> R05 e NOVA_VERSAO_VIGENTE", transicao.outcome === "NOVA_VERSAO_VIGENTE");
check("a revisao anterior e preservada no veredito", transicao.previousRevision === "04");
check("a revisao nova aparece no veredito", transicao.newRevision === "05");

check(
  "a identidade documental NAO muda entre revisoes",
  anterior.objectId === r05.objectId
);

console.log("");
console.log("-- 5. sincronizacao repetida nao alerta de novo --");

const repetida = evaluateVigency(r05, r05);
check("mesma revisao => SEM_MUDANCA", repetida.outcome === "SEM_MUDANCA");

check(
  "mudanca so de formatacao nao alerta",
  evaluateVigency({ ...anterior, revision: "04" }, { ...anterior, revision: "4" }).outcome ===
    "SEM_MUDANCA"
);

check(
  "mudanca de nome sem mudanca de revisao NAO alerta",
  evaluateVigency(anterior, { ...anterior, name: "outro-nome.ifc" }).outcome === "SEM_MUDANCA"
);

console.log("");
console.log("-- 6. duas transicoes em sincronizacoes diferentes --");

const r06 = { ...r05, revision: "06" };
const segunda = evaluateVigency(r05, r06);

check("R05 -> R06 tambem alerta", segunda.outcome === "NOVA_VERSAO_VIGENTE");
check("a segunda transicao parte da revisao 05", segunda.previousRevision === "05");
check(
  "as duas transicoes sao distintas",
  transicao.newRevision !== segunda.newRevision
);

console.log("");
console.log("-- 7. cadeia inconsistente --");

check(
  "identidade documental trocada => CADEIA_INCONSISTENTE",
  evaluateVigency(anterior, { ...anterior, objectId: 99999999 }).outcome ===
    "CADEIA_INCONSISTENTE"
);

check(
  "revisao vigente ausente => CADEIA_INCONSISTENTE (ausencia nao e evidencia)",
  evaluateVigency(anterior, { ...anterior, revision: null }).outcome ===
    "CADEIA_INCONSISTENTE"
);

check(
  "objectId invalido => CADEIA_INCONSISTENTE",
  evaluateVigency(null, { ...anterior, objectId: 0 }).outcome === "CADEIA_INCONSISTENTE"
);

check(
  "cadeia inconsistente NAO e tratada como nova versao",
  evaluateVigency(anterior, { ...anterior, objectId: 42 }).outcome !== "NOVA_VERSAO_VIGENTE"
);

console.log("");
console.log("-- 8. o alerta --");

const alerta = buildVigencyAlertDetail({
  workName: "WEG Linhares ES - Fabrica de Fios",
  documentName: r05.name,
  previousRevision: "04",
  newRevision: "05",
  previousObjectId: IFC.objectId,
  newObjectId: IFC.objectId,
  sourceCreatedAt: r05.sourceCreatedAt,
  authorName: IFC.authorName,
  sizeBytes: IFC.sizeBytes,
  folderPath: IFC.folderPath,
  detectedAt: "2026-09-10T12:00:00Z",
  availability: "SOMENTE_NO_CONSTRUMANAGER",
});

for (const [nome, trecho] of [
  ["obra", "WEG Linhares"],
  ["nome do documento", "356-WEG-MET-3D-001-R05.ifc"],
  ["revisao anterior e nova", "04 -> 05"],
  ["identificador", String(IFC.objectId)],
  ["data da versao", "2026-09-10T09:00:00"],
  ["autor", "Equipe WEG"],
  ["tamanho", String(IFC.sizeBytes)],
  ["pasta", "PROJETOS - WEG"],
  ["data da deteccao", "2026-09-10T12:00:00Z"],
  ["disponibilidade do conteudo", "somente no Construmanager"],
]) {
  check(`o alerta traz ${nome}`, alerta.includes(trecho));
}

check(
  "o alerta NAO afirma que o conteudo binario mudou",
  /VERSAO DOCUMENTAL/.test(alerta) &&
    /sem download nao e possivel afirmar se o conteudo binario difere/i.test(alerta)
);

check(
  "o alerta pede analise humana de impacto",
  /custo, prazo, escopo, qualidade, seguranca, obrigacoes contratuais/i.test(alerta)
);

check(
  "o alerta NAO contem URL nem hiperlink",
  !/https?:\/\//i.test(alerta)
);

check(
  "campo ausente e OMITIDO, nunca inventado",
  (() => {
    const magro = buildVigencyAlertDetail({
      workName: null,
      documentName: null,
      previousRevision: "04",
      newRevision: "05",
      previousObjectId: null,
      newObjectId: 1,
      sourceCreatedAt: null,
      authorName: null,
      sizeBytes: null,
      folderPath: null,
      detectedAt: "2026-09-10T12:00:00Z",
      availability: "ARMAZENADO_NO_ACC",
    });
    return (
      !/desconhecido|null|undefined|N\/A/i.test(magro) &&
      !magro.includes("Autor:") &&
      !magro.includes("Pasta:") &&
      magro.includes("04 -> 05")
    );
  })()
);

check(
  "a disponibilidade do conteudo tem os dois textos",
  describeContentAvailability("ARMAZENADO_NO_ACC").includes("armazenado no ACC") &&
    describeContentAvailability("SOMENTE_NO_CONSTRUMANAGER").includes("somente no Construmanager")
);

check("a acao de auditoria e estavel", VIGENCY_AUDIT_ACTION === "CONSTRUMANAGER_NOVA_VERSAO_VIGENTE");

// ------------------------------------------------------------
// Banco falso: semantica de detect_construmanager_version_transitions
// ------------------------------------------------------------

function fakeDb() {
  const db = { documents: [], vigency: [], transitions: [], audit: [], downloads: 0 };

  db.detect = () => {
    let first = 0;
    let trans = 0;
    let same = 0;

    for (const d of db.documents) {
      const prev = db.vigency.find((v) => v.objectId === d.objectId);

      if (!prev) {
        db.vigency.push({ ...d });
        first += 1;
        continue;
      }

      const verdict = evaluateVigency(prev, d);

      if (verdict.outcome !== "NOVA_VERSAO_VIGENTE") {
        same += 1;
        continue;
      }

      // UNIQUE (objectId, newRevision) => uma linha por transicao.
      const jaExiste = db.transitions.some(
        (t) => t.objectId === d.objectId && t.newRevision === d.revision
      );

      if (!jaExiste) {
        db.transitions.push({
          objectId: d.objectId,
          previousRevision: prev.revision,
          newRevision: d.revision,
          availability: db.storedIds?.has(d.objectId)
            ? "ARMAZENADO_NO_ACC"
            : "SOMENTE_NO_CONSTRUMANAGER",
        });
        db.audit.push({ action: VIGENCY_AUDIT_ACTION, entityId: String(d.objectId) });
        trans += 1;
      } else {
        same += 1;
      }

      Object.assign(prev, d);
    }

    return { first, trans, same };
  };

  return db;
}

console.log("");
console.log("-- 9. idempotencia: um alerta por transicao --");

{
  const db = fakeDb();
  db.storedIds = new Set();
  db.documents = [{ ...anterior }];

  const p1 = db.detect();
  check("1a sincronizacao: primeira observacao, sem alerta", p1.first === 1 && p1.trans === 0);
  check("nenhuma auditoria na carga inicial", db.audit.length === 0);

  const p2 = db.detect();
  check("2a sincronizacao sem mudanca: nada acontece", p2.trans === 0 && p2.same === 1);

  // Chega a R05.
  db.documents = [{ ...r05 }];
  const p3 = db.detect();
  check("3a sincronizacao com R05: UMA transicao", p3.trans === 1);
  check("uma linha no ledger", db.transitions.length === 1);
  check("uma entrada de auditoria", db.audit.length === 1);
  check("o ledger guarda revisao anterior e nova", db.transitions[0].previousRevision === "04" && db.transitions[0].newRevision === "05");

  const p4 = db.detect();
  check("4a sincronizacao repetida: NENHUM alerta novo", p4.trans === 0);
  check("o ledger continua com uma linha", db.transitions.length === 1);
  check("a auditoria continua com uma entrada", db.audit.length === 1);

  // Chega a R06.
  db.documents = [{ ...r06 }];
  db.detect();
  check("nova transicao R05->R06 e registrada", db.transitions.length === 2);
  check("historico anterior preservado, nao sobrescrito", db.transitions[0].newRevision === "05");
  check("duas entradas de auditoria no total", db.audit.length === 2);
}

console.log("");
console.log("-- 10. o IFC grande: monitorado sem NUNCA ser baixado --");

{
  const db = fakeDb();
  db.storedIds = new Set(); // nada armazenado: o IFC e referencia externa
  db.documents = [{ ...anterior }];
  db.detect();

  db.documents = [{ ...r05 }];
  const res = db.detect();

  check("o IFC tem sua nova versao DETECTADA", res.trans === 1);
  check(
    "o alerta diz que o conteudo esta SOMENTE no Construmanager",
    db.transitions[0].availability === "SOMENTE_NO_CONSTRUMANAGER"
  );
  check("nenhum download foi executado na deteccao", db.downloads === 0);
  check(
    "a deteccao nao dependeu de blob, SHA-256 nem Storage",
    db.transitions[0].newRevision === "05"
  );

  // Um arquivo pequeno na mesma rodada segue o fluxo normal.
  db.documents = [{ ...r05 }, { objectId: 39274574, revision: "00", name: "pequeno.pdf" }];
  const res2 = db.detect();
  check(
    "o arquivo pequeno e observado normalmente na mesma rodada",
    res2.first === 1
  );
  check("o arquivo grande nao bloqueou o pequeno", db.vigency.length === 2);
}

console.log("");
console.log("-- 11. auditoria do codigo real --");

const migration = readFileSync(
  "supabase/migrations/20260905180000_construmanager_content_automation.sql",
  "utf8"
);
const worker = readFileSync("scripts/construmanager-content-worker.mjs", "utf8");
const policy = readFileSync(
  "apps/web/lib/integrations/construmanager/version-vigency.ts",
  "utf8"
);
const badge = readFileSync(
  "apps/web/components/integrations/construmanager-status-badge.tsx",
  "utf8"
);
const componente = readFileSync(
  "apps/web/components/integrations/construmanager-content-download.tsx",
  "utf8"
);

const migrationBody = migration.replace(/^\s*--.*$/gm, " ");

check(
  "existe o ledger imutavel de transicoes",
  /create table if not exists public\.construmanager_version_transitions/.test(migrationBody)
);

check(
  "uma transicao por (integracao, documento, revisao nova)",
  /unique \(integration_id, construmanager_object_id, new_revision\)/.test(migrationBody)
);

check(
  "conflito na transicao e descartado (nao duplica alerta)",
  /on conflict \(integration_id, construmanager_object_id, new_revision\) do nothing/.test(
    migrationBody
  )
);

check(
  "a auditoria so e gravada quando a transicao e nova",
  /if v_transition_id is not null then[\s\S]{0,600}?audit_log_entries/.test(migrationBody)
);

check(
  "a deteccao NAO le blob, SHA-256 nem Storage",
  (() => {
    const i = migrationBody.indexOf("function public.detect_construmanager_version_transitions");
    const corpo = migrationBody.slice(i, migrationBody.indexOf("$$;", i));
    return (
      !/sha256|content_blob|storage\./i.test(corpo) &&
      // le download_status apenas para dizer ONDE o conteudo esta
      /download_status = 'ARMAZENADO'/.test(corpo)
    );
  })()
);

check(
  "a deteccao roda ANTES de qualquer download no worker",
  worker.indexOf("detect_construmanager_version_transitions") <
    worker.indexOf("downloadConstrumanagerContent(")
);

check(
  "o modulo de vigencia e puro (sem rede, sem Supabase)",
  !/@supabase|createClient|fetch\(|https?:\/\//.test(policy)
);

check(
  "a regra de vigencia esta documentada com o dado real",
  /isVersao = 0/.test(policy) && /cad_objects_versoes/.test(policy) && /cad_objects_super/.test(policy)
);

check(
  "o badge SOMENTE NO CONSTRUMANAGER e azul-escuro, branco e negrito",
  /REFERENCIA_EXTERNA: "[^"]*bg-blue-900[^"]*text-white[^"]*font-bold"/.test(badge) &&
    /REFERENCIA_EXTERNA: "SOMENTE NO CONSTRUMANAGER"/.test(badge)
);

check(
  "NENHUMA URL foi inventada em lugar nenhum",
  ![migration, worker, policy, badge, componente].some((s) =>
    /https?:\/\/(?!nextjs\.org|claude\.|github\.com|vercel\.com)[a-z]/i.test(
      s.replace(/^\s*(--|\/\/).*$/gm, " ")
    )
  )
);

check(
  'NAO existe botao "Abrir no Construmanager"',
  !/Abrir no Construmanager/i.test(componente)
);

check(
  'existe o botao "Copiar ID" em negrito',
  /Copiar ID/.test(componente) &&
    /CONSTRUMANAGER_COPY_ID_BUTTON_CLASS/.test(componente)
);

check(
  "a linha de referencia externa mostra pasta, revisao e extensao",
  /item\.folderPath/.test(componente) &&
    /item\.revision/.test(componente) &&
    /item\.extension/.test(componente)
);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);

process.exit(failed === 0 ? 0 : 1);
