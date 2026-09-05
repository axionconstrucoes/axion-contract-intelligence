// Pacote D — worker de ingestao automatica de conteudo do Construmanager.
//
// Roda FORA do navegador, sob o agendador, com a secret key server-side.
// Reutiliza os modulos que o piloto do Pacote C validou — download,
// leitura segura do ZIP, SHA-256, caminho content-addressed — sem
// reimplementar nenhum deles: divergir esse codigo seria a forma mais
// barata de corromper o acervo.
//
// A dedup tambem NAO e reimplementada: complete_construmanager_content_
// download_system delega a RPC do Pacote C, a mesma que o botao manual
// usa.
//
// Uso:
//   node scripts/construmanager-content-worker.mjs [projectId]
//
// Nao aceita flags de "forcar": ligar a automacao e mudar variavel de
// ambiente, nao passar argumento na linha de comando.

import { randomUUID } from "node:crypto";
import { register } from "node:module";
import { openAsBlob } from "node:fs";
import { createClient } from "@supabase/supabase-js";

register("./ts-module-resolver.mjs", import.meta.url);

const {
  resolveAutomationConfig,
  computeBackoffSeconds,
  evaluateSizePolicy,
  hasTimeBudgetFor,
  DEFAULT_ITEM_RESERVE_MS,
} = await import("../apps/web/lib/integrations/construmanager/automation-policy.ts");

const { createConstrumanagerClient } = await import(
  "../apps/web/lib/integrations/construmanager/client.ts"
);

const { downloadConstrumanagerContent, buildContentStoragePath } = await import(
  "../apps/web/lib/integrations/construmanager/download-content.ts"
);

const { sanitizeConstrumanagerContentError } = await import(
  "../apps/web/lib/integrations/construmanager/sanitize-error.ts"
);

const CONTENT_BUCKET = "construmanager-content";

const PROJECT_ID =
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ??
  "00000000-0000-4000-8000-000000000001";

// Identidade da rodada. Vem do agendador quando existe, para que o
// lease no banco seja rastreavel ate a execucao que o criou.
const WORKER_ID = process.env.GITHUB_RUN_ID
  ? `gha-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`
  : `local-${randomUUID()}`;

const TRIGGER_TYPE =
  process.env.GITHUB_EVENT_NAME === "schedule" ? "AUTOMATICO" : "MANUAL";

function log(message) {
  console.log(`[construmanager-worker] ${message}`);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variavel de ambiente ausente: ${name}`);
  return value;
}

// ---------------------------------------------------------------------
// Porta de entrada: fail-closed antes de qualquer conexao
// ---------------------------------------------------------------------

const decision = resolveAutomationConfig(process.env);

if (!decision.enabled) {
  log(`Automacao DESLIGADA. ${decision.reason}`);
  log("Nenhuma conexao aberta, nenhum download, nenhuma escrita.");
  process.exit(0);
}

const config = decision.config;

log(
  `Automacao ligada | dryRun=${config.dryRun} | maxItens=${config.maxItems} | ` +
    `maxBytesPorArquivo=${config.maxFileBytes} | orcamento=${config.timeBudgetMs}ms | worker=${WORKER_ID}`
);

const supabase = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SECRET_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

function firstRow(data) {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

// ---------------------------------------------------------------------
// DRY-RUN: somente leitura. Nao prepara, nao adquire, nao baixa, nao grava.
// ---------------------------------------------------------------------

if (config.dryRun) {
  log("MODO DRY-RUN — somente leitura. Nenhuma linha sera escrita.");

  const { data, error } = await supabase
    .from("construmanager_content_links")
    .select(
      "id, construmanager_object_id, source_name, download_status, auto_attempts, requires_human_decision, next_attempt_at, construmanager_documents (size_bytes), construmanager_document_versions (size_bytes)"
    )
    .eq("project_id", PROJECT_ID)
    .in("download_status", ["PENDENTE", "ERRO"])
    .eq("requires_human_decision", false)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) throw new Error(error.message);

  const agora = Date.now();
  const candidatos = [];
  const referenciaExterna = [];
  const decisaoHumana = [];
  const foraPorBackoff = [];

  for (const row of data ?? []) {
    const size =
      row.construmanager_documents?.size_bytes ??
      row.construmanager_document_versions?.size_bytes ??
      null;

    if (row.next_attempt_at && new Date(row.next_attempt_at).getTime() > agora) {
      foraPorBackoff.push(row);
      continue;
    }

    const verdict = evaluateSizePolicy(size, config.maxFileBytes);

    if (verdict.classification === "REFERENCIA_EXTERNA") {
      referenciaExterna.push({ row, size });
      continue;
    }

    if (verdict.classification === "DECISAO_HUMANA") {
      decisaoHumana.push({ row, verdict });
      continue;
    }

    candidatos.push({ row, size });
  }

  const selecionados = candidatos.slice(0, config.maxItems);

  log(`elegiveis agora .............. ${candidatos.length}`);
  log(`seriam selecionados .......... ${selecionados.length} (teto ${config.maxItems})`);
  log(`fora por backoff ............. ${foraPorBackoff.length}`);
  log(`viram referencia externa ..... ${referenciaExterna.length}`);
  log(`anomalia (decisao humana) .... ${decisaoHumana.length}`);

  for (const item of selecionados) {
    log(`  BAIXARIA #${item.row.construmanager_object_id} ${item.row.source_name} (${item.size} bytes)`);
  }

  for (const item of referenciaExterna) {
    log(
      `  SOMENTE NO CONSTRUMANAGER #${item.row.construmanager_object_id} ${item.row.source_name} (${item.size} bytes) — nao seria baixado`
    );
  }

  for (const item of decisaoHumana) {
    log(
      `  DECISAO HUMANA #${item.row.construmanager_object_id} ${item.row.source_name} — ${item.verdict.reason}`
    );
  }

  log("DRY-RUN concluido. Zero escritas, zero downloads, zero classificacoes gravadas.");
  process.exit(0);
}

// ---------------------------------------------------------------------
// EXECUCAO REAL
// ---------------------------------------------------------------------

const inicio = Date.now();
let runId = null;

let selected = 0;
let stored = 0;
let reused = 0;
let failed = 0;
let humanDecision = 0;
let externalReferences = 0;
let versionTransitions = 0;
let bytesDownloaded = 0;
let bytesStored = 0;
let firstError = null;

// Itens adquiridos e ainda nao processados: se a rodada terminar antes
// deles, o lease e devolvido explicitamente em vez de esperar expirar.
const naoProcessados = new Set();

try {
  runId = await rpc("start_construmanager_content_run", {
    p_project_id: PROJECT_ID,
    p_worker_id: WORKER_ID,
    p_trigger_type: TRIGGER_TYPE,
    p_dry_run: false,
  });

  // 1. Preparacao automatica: vinculos novos que a sincronizacao de
  //    metadados trouxe. Idempotente (ON CONFLICT DO NOTHING).
  const prep = firstRow(
    await rpc("ensure_construmanager_content_links_system", { p_project_id: PROJECT_ID })
  );

  log(
    `preparacao: ${prep?.links_created ?? 0} vinculo(s) novo(s) | ` +
      `${prep?.pending_total ?? 0} aguardando download`
  );

  // 2. NOVA VERSAO VIGENTE — o requisito central da automacao.
  //
  //    Roda ANTES de qualquer download e nao depende de nenhum: compara
  //    a revisao vigente recem-sincronizada com a ultima observada. Um
  //    arquivo grande, que nunca sera baixado, tem sua troca de revisao
  //    detectada exatamente como os pequenos.
  //
  //    Idempotente: a segunda execucao sobre a mesma sincronizacao
  //    devolve 0 transicoes e nao repete alerta.
  const vigencia = firstRow(
    await rpc("detect_construmanager_version_transitions", {
      p_project_id: PROJECT_ID,
    })
  );

  versionTransitions = Number(vigencia?.transitions ?? 0);

  log(
    `vigencia: ${vigencia?.first_observations ?? 0} primeira(s) observacao(oes) | ` +
      `${versionTransitions} NOVA(S) VERSAO(OES) VIGENTE(S) | ` +
      `${vigencia?.unchanged ?? 0} sem mudanca`
  );

  // 3. Classificacao de armazenamento, ANTES de qualquer transferencia.
  //    Acima do limite => REFERENCIA_EXTERNA: o arquivo fica no
  //    Construmanager. Nao e erro, nao e pendencia, nao consome
  //    tentativa e nao bloqueia os menores. Idempotente e reversivel:
  //    se o limite subir, a mesma RPC devolve os itens a fila.
  const classificacao = firstRow(
    await rpc("classify_construmanager_external_references", {
      p_project_id: PROJECT_ID,
      p_max_bytes: config.maxFileBytes,
    })
  );

  externalReferences = Number(classificacao?.external_total ?? 0);

  log(
    `classificacao: ${classificacao?.classified ?? 0} novo(s) como referencia externa | ` +
      `${classificacao?.reverted ?? 0} devolvido(s) a fila | ` +
      `${externalReferences} referencia(s) externa(s) no total`
  );

  // 4. Anomalia real: tamanho ausente nos metadados. Nao da para
  //    classificar nem estimar custo — isso sim precisa de gente.
  const { data: semTamanho, error: semTamErr } = await supabase
    .from("construmanager_content_links")
    .select(
      "id, construmanager_object_id, source_name, construmanager_documents (size_bytes), construmanager_document_versions (size_bytes)"
    )
    .eq("project_id", PROJECT_ID)
    .in("download_status", ["PENDENTE", "ERRO"])
    .eq("requires_human_decision", false)
    .limit(500);

  if (semTamErr) throw new Error(semTamErr.message);

  for (const row of semTamanho ?? []) {
    const size =
      row.construmanager_documents?.size_bytes ??
      row.construmanager_document_versions?.size_bytes ??
      null;

    const verdict = evaluateSizePolicy(size, config.maxFileBytes);

    // REFERENCIA_EXTERNA ja foi tratada pela RPC acima; aqui so resta
    // anomalia de verdade.
    if (verdict.classification !== "DECISAO_HUMANA") continue;

    await rpc("flag_construmanager_content_human_decision", {
      p_project_id: PROJECT_ID,
      p_link_id: row.id,
      p_reason: verdict.reason,
      p_detail: verdict.detail,
    });

    humanDecision += 1;
    log(`decisao humana: #${row.construmanager_object_id} ${row.source_name} — ${verdict.reason}`);
  }

  // 5. Autentica UMA vez para a rodada. O token vale ~24 h; reautenticar
  //    por arquivo so multiplicaria a exposicao da credencial.
  const { data: integ, error: integErr } = await supabase
    .from("project_integrations")
    .select("account_reference, external_project_reference")
    .eq("project_id", PROJECT_ID)
    .eq("source_type", "CONSTRUMANAGER")
    .maybeSingle();

  if (integErr) throw new Error(integErr.message);

  const companyId = Number.parseInt(String(integ?.account_reference ?? ""), 10);
  const workId = Number.parseInt(
    String(integ?.external_project_reference ?? "").split("-")[0].trim(),
    10
  );

  if (!Number.isInteger(companyId) || !Number.isInteger(workId)) {
    throw new Error("Configuracao da integracao Construmanager incompleta.");
  }

  const client = createConstrumanagerClient();
  const auth = await client.authenticate();

  if (auth.user.companyId !== companyId) {
    throw new Error("A conta configurada nao corresponde a empresa retornada pela API.");
  }

  const token = await client.getAccessToken(auth.user.token);

  // 6. Aquisicao + processamento, SEQUENCIAL de proposito: downloads de
  //    centenas de MB em paralelo multiplicariam disco temporario e banda
  //    sem ganho nesta fase.
  const alvos = await rpc("claim_construmanager_content_targets", {
    p_project_id: PROJECT_ID,
    p_worker_id: WORKER_ID,
    p_limit: config.maxItems,
    p_max_bytes: config.maxFileBytes,
    p_lease_seconds: config.leaseSeconds,
  });

  selected = (alvos ?? []).length;
  log(`adquiridos: ${selected} alvo(s)`);

  for (const alvo of alvos ?? []) {
    naoProcessados.add(alvo.link_id);
  }

  for (const alvo of alvos ?? []) {
    const decorrido = Date.now() - inicio;

    if (!hasTimeBudgetFor(decorrido, config.timeBudgetMs, DEFAULT_ITEM_RESERVE_MS)) {
      log("orcamento de tempo esgotado — devolvendo os alvos restantes a fila.");
      break;
    }

    let cleanup = null;

    try {
      const content = await downloadConstrumanagerContent(
        client,
        token.access_token,
        companyId,
        workId,
        {
          linkId: alvo.link_id,
          objectId: Number(alvo.construmanager_object_id),
          name: alvo.source_name,
          extensionNormalized: alvo.extension_normalized,
        },
        {}
      );

      cleanup = content.cleanup;
      bytesDownloaded += Number(content.sizeBytes ?? 0);

      const storagePath = buildContentStoragePath(content.sha256);

      // Dedup: o conteudo ja existe? Entao o Storage nem e tocado.
      // Leitura direta porque o worker usa service_role — a RPC
      // equivalente do Pacote C exige sessao de usuario.
      const { data: existente, error: buscaErr } = await supabase
        .from("construmanager_content_blobs")
        .select("id")
        .eq("sha256", content.sha256)
        .maybeSingle();

      if (buscaErr) throw new Error(buscaErr.message);

      if (!existente) {
        const contentType = content.mimeType ?? "application/octet-stream";
        const body = await openAsBlob(content.contentPath, { type: contentType });

        const { error: upErr } = await supabase.storage
          .from(CONTENT_BUCKET)
          .upload(storagePath, body, { contentType, upsert: true });

        if (upErr) throw new Error(`Falha ao armazenar o conteudo: ${upErr.message}`);

        bytesStored += Number(content.sizeBytes ?? 0);
      }

      const done = firstRow(
        await rpc("complete_construmanager_content_download_system", {
          p_project_id: PROJECT_ID,
          p_link_id: alvo.link_id,
          p_sha256: content.sha256,
          p_size_bytes: content.sizeBytes,
          p_storage_bucket: CONTENT_BUCKET,
          p_storage_path: storagePath,
          p_mime_type: content.mimeType,
          p_detected_extension: content.detectedExtension,
          p_zip_entry_path: content.zipEntryPath,
        })
      );

      stored += 1;
      if (done?.blob_reused) reused += 1;

      naoProcessados.delete(alvo.link_id);

      log(
        `ARMAZENADO #${alvo.construmanager_object_id} ${alvo.source_name} | ` +
          `sha=${content.sha256.slice(0, 12)} | ${content.sizeBytes} bytes | ` +
          `${done?.blob_reused ? "reaproveitado" : "novo"}`
      );
    } catch (error) {
      const message = sanitizeConstrumanagerContentError(error);
      if (!firstError) firstError = message;

      const resultado = firstRow(
        await rpc("fail_construmanager_content_download_system", {
          p_project_id: PROJECT_ID,
          p_link_id: alvo.link_id,
          p_error: message,
          p_backoff_seconds: computeBackoffSeconds(Number(alvo.auto_attempts ?? 1)),
          p_max_auto_attempts: config.maxAutoAttempts,
        })
      ).catch(() => null);

      failed += 1;
      naoProcessados.delete(alvo.link_id);

      if (resultado?.requires_human_decision) {
        humanDecision += 1;
        log(`ESGOTADO #${alvo.construmanager_object_id} — aguarda decisao humana: ${message}`);
      } else {
        log(`ERRO #${alvo.construmanager_object_id} — nova tentativa agendada: ${message}`);
      }
    } finally {
      if (cleanup) await cleanup().catch(() => undefined);
    }
  }

  // 7. Devolve o que foi adquirido e nao processado.
  for (const linkId of naoProcessados) {
    await rpc("release_construmanager_content_lease", {
      p_project_id: PROJECT_ID,
      p_link_id: linkId,
      p_worker_id: WORKER_ID,
    }).catch(() => undefined);
  }

  const status = failed === 0 ? "SUCESSO" : stored > 0 ? "PARCIAL" : "ERRO";

  await rpc("finish_construmanager_content_run", {
    p_run_id: runId,
    p_status: status,
    p_selected: selected,
    p_stored: stored,
    p_reused: reused,
    p_failed: failed,
    p_human_decision_count: humanDecision,
    p_external_references: externalReferences,
    p_bytes_downloaded: bytesDownloaded,
    p_bytes_stored: bytesStored,
    p_duration_ms: Date.now() - inicio,
    p_error: firstError,
  });

  log(
    `rodada ${status} | selecionados=${selected} armazenados=${stored} ` +
      `reaproveitados=${reused} erros=${failed} decisaoHumana=${humanDecision} ` +
      `referenciaExterna=${externalReferences} novaVersaoVigente=${versionTransitions} | ` +
      `baixados=${bytesDownloaded}B armazenados=${bytesStored}B | ${Date.now() - inicio}ms`
  );

  process.exit(0);
} catch (error) {
  const message = sanitizeConstrumanagerContentError(error);
  log(`FALHA DA RODADA: ${message}`);

  // Devolve leases mesmo quando a rodada inteira falha.
  for (const linkId of naoProcessados) {
    await rpc("release_construmanager_content_lease", {
      p_project_id: PROJECT_ID,
      p_link_id: linkId,
      p_worker_id: WORKER_ID,
    }).catch(() => undefined);
  }

  if (runId) {
    await rpc("finish_construmanager_content_run", {
      p_run_id: runId,
      p_status: "ERRO",
      p_selected: selected,
      p_stored: stored,
      p_reused: reused,
      p_failed: failed,
      p_human_decision_count: humanDecision,
    p_external_references: externalReferences,
      p_bytes_downloaded: bytesDownloaded,
      p_bytes_stored: bytesStored,
      p_duration_ms: Date.now() - inicio,
      p_error: message,
    }).catch(() => undefined);
  }

  process.exit(1);
}
