// Sincronizacao DETERMINISTICA do Diario de Obra.
//
// ZERO TOKEN DE LLM. Nao ha import de IA, nao ha chamada a especialista,
// nao ha analise semantica. Tudo aqui e' listagem, comparacao de hash,
// upsert e contagem.
//
// ZERO MIDIA. Foto, video, anexo e PDF existem apenas como numero. O
// client recusa qualquer caminho de midia antes da rede.
//
// FONTE INDEPENDENTE. Nada do Construmanager e' importado ou lido aqui.
//
// DOIS MODOS
//
//   BASELINE     importacao historica por janelas, com checkpoint para
//                continuar noutra execucao. Nao gera alteracao.
//   INCREMENTAL  janela movel de 14 dias; busca detalhe SO de RDO novo
//                ou com `modified` avancado.
//
// RECONCILE existe na politica e ainda nao tem execucao propria: e' a
// varredura periodica do historico, necessaria porque os filtros da API
// sao pela DATA DO RELATORIO e nao por `modified` — uma edicao feita
// hoje num RDO antigo fica fora da janela incremental.
//
// Uso:
//   node scripts/diario-de-obra-sync-worker.mjs <projectId> <obraId> <modo>

import { register } from "node:module";
import { createClient } from "@supabase/supabase-js";

register("./ts-module-resolver.mjs", import.meta.url);

const { DiarioDeObraClient, DIARIO_LIMITE_LOTE, sanitizeDiarioError } = await import(
  "../apps/web/lib/integrations/diario-de-obra/client.ts"
);

const {
  resolveDiarioSyncEnabled,
  resolveModo,
  maxDetalhesPara,
  janelaIncremental,
  janelaBaseline,
  lerRetomadaBaseline,
  montarCheckpointBaseline,
  avaliarJanela,
  somarDias,
  BASELINE_DATA_MINIMA,
} = await import("../apps/web/lib/integrations/diario-de-obra/sync-policy.ts");

const { normalizarRelatorio, ehCandidato, apenasData } = await import(
  "../apps/web/lib/integrations/diario-de-obra/normalize-report.ts"
);

function log(mensagem) {
  console.log(`[diario-de-obra-sync] ${mensagem}`);
}

// Argumento vazio NAO e' ausencia: `??` captura null/undefined, nao "".
const argumentos = process.argv.slice(2).filter((a) => a.trim() !== "");
const PROJECT_ID = argumentos[0];
const OBRA_ID = argumentos[1];
const MODO_BRUTO = argumentos[2];

function requiredEnv(nome) {
  const valor = process.env[nome]?.trim();
  if (!valor) throw new Error(`Variavel de ambiente ausente: ${nome}`);
  return valor;
}

// 1. Interruptor — antes de qualquer conexao.
const decisao = resolveDiarioSyncEnabled(process.env);

if (!decisao.enabled) {
  log(`Sincronizacao DESLIGADA. ${decisao.reason}`);
  log("Nenhuma conexao aberta, nenhuma coleta, nenhuma escrita.");
  process.exit(0);
}

const MODO = resolveModo(MODO_BRUTO);

if (MODO === null || MODO === "RECONCILE") {
  log(`Modo invalido ou ainda nao executavel: ${MODO_BRUTO ?? "(ausente)"}.`);
  log("Modos executaveis nesta etapa: baseline, incremental.");
  process.exit(1);
}

if (!/^[0-9a-f-]{36}$/i.test(String(PROJECT_ID ?? ""))) {
  log("projectId ausente ou malformado.");
  process.exit(1);
}

if (!/^[a-f0-9]{24}$/.test(String(OBRA_ID ?? ""))) {
  log("obraId ausente ou malformado.");
  process.exit(1);
}

const supabase = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SECRET_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

const api = new DiarioDeObraClient({ token: requiredEnv("DIARIO_DE_OBRA_API_TOKEN") });

const inicio = Date.now();
let syncRunId = null;

// PRE-CONDICAO: a integracao precisa existir.
//
// `diario_de_obra_reports.integration_id` referencia a linha de
// project_integrations com source_type = 'DIARIO_OBRA' — o CHECK do
// banco ja aceita esse valor. Este worker NAO cria a integracao: criar
// vinculo de origem e decisao de configuracao, nao efeito colateral de
// uma sincronizacao. A checagem vem ANTES de abrir a execucao e antes de
// qualquer chamada a API externa, para falhar sem consumir nada.
{
  const { data: integ, error } = await supabase
    .from("project_integrations")
    .select("id")
    .eq("project_id", PROJECT_ID)
    .eq("source_type", "DIARIO_OBRA");

  if (error) {
    log(`FALHA ao verificar a integracao: ${sanitizeDiarioError(error)}`);
    process.exit(1);
  }

  if (!integ || integ.length === 0) {
    log("Integracao DIARIO_OBRA nao configurada para este projeto.");
    log("Configure a origem antes de sincronizar. Nenhuma chamada a API foi feita.");
    process.exit(1);
  }

  if (integ.length > 1) {
    // Duas integracoes para a mesma origem tornariam `integration_id`
    // ambiguo e poderiam duplicar historico.
    log(`Ha ${integ.length} integracoes DIARIO_OBRA neste projeto; deve haver exatamente uma.`);
    process.exit(1);
  }
}

try {
  const hoje = new Date().toISOString().slice(0, 10);

  // 2. Janela inicial.
  //
  // BASELINE retoma do checkpoint da ultima execucao; sem checkpoint,
  // parte do piso configurado. INCREMENTAL usa a janela movel.
  let janelaInicial;
  let pisoBaseline = BASELINE_DATA_MINIMA;

  if (MODO === "INCREMENTAL") {
    janelaInicial = janelaIncremental(hoje);
  } else {
    // Piso: a data de inicio do projeto. Sem ela, o piso absoluto. E' o
    // que garante que a varredura TERMINA em vez de descer para sempre.
    const { data: projeto } = await supabase
      .from("projects")
      .select("start_date")
      .eq("id", PROJECT_ID)
      .maybeSingle();

    if (projeto?.start_date) pisoBaseline = String(projeto.start_date).slice(0, 10);

    const { data: ultimo } = await supabase
      .from("diario_de_obra_sync_runs")
      .select("checkpoint")
      .eq("project_id", PROJECT_ID)
      .eq("mode", "BASELINE")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // DECRESCENTE: a primeira execucao parte de HOJE e caminha para
    // tras. Comecar no piso historico gastaria dezenas de janelas vazias
    // antes de alcancar os RDOs recentes.
    //
    // A retomada vem do estado EXPLICITO do checkpoint — e aceita os
    // formatos antigos. Antes, um run que batia no teto nao registrava a
    // janela em curso e o processo seguinte recomecava de hoje.
    const retomada = lerRetomadaBaseline(ultimo?.checkpoint ?? null);

    if (retomada.baselineComplete) {
      log("Baseline ja concluido segundo o checkpoint. Nenhuma chamada a API foi feita.");
      process.exit(0);
    }

    janelaInicial = janelaBaseline(hoje, retomada.resumeWindowEnd, pisoBaseline);

    if (janelaInicial === null) {
      log(`Baseline concluido: o historico ja foi varrido ate o piso ${pisoBaseline}.`);
      log("Nenhuma chamada a API foi feita.");
      process.exit(0);
    }
  }

  syncRunId = (
    await supabase
      .rpc("start_diario_de_obra_sync_run", {
        p_project_id: PROJECT_ID,
        p_mode: MODO,
        p_window_start: janelaInicial.inicio,
        p_window_end: janelaInicial.fim,
      })
      .then((r) => {
        if (r.error) throw new Error(r.error.message);
        return r.data;
      })
  );

  log(`execucao ${syncRunId} | modo ${MODO} | janela ${janelaInicial.inicio} .. ${janelaInicial.fim}`);

  // 3. A obra: contador de telemetria, NUNCA controle de fluxo.
  //
  //    visaoGeral.total.relatorios detecta variacao de QUANTIDADE, e nao
  //    edicao de um RDO existente. Encerrar porque o total nao mudou
  //    esconderia exatamente o caso que este modulo existe para achar.
  const obra = await api.getObra(OBRA_ID);
  const totalNaOrigem = Number(obra?.visaoGeral?.total?.relatorios ?? 0);
  log(`obra: ${totalNaOrigem} relatorio(s) na origem (telemetria; nao encerra a execucao)`);

  // 4. Varredura por janelas, com subdivisao quando o lote vier cheio.
  const pendentes = [janelaInicial];
  const resumos = new Map();
  let janelasCompletas = 0;
  let falhaDeCobertura = null;

  while (pendentes.length > 0) {
    const janela = pendentes.shift();

    const lote = await api.listarRelatorios(OBRA_ID, {
      dataInicio: janela.inicio,
      dataFim: janela.fim,
      limite: DIARIO_LIMITE_LOTE,
      ordem: "desc",
    });

    for (const resumo of lote) {
      const id = String(resumo?._id ?? "");
      if (id) resumos.set(id, resumo);
    }

    const veredito = avaliarJanela(janela, lote.length, DIARIO_LIMITE_LOTE);

    if (veredito.tipo === "COMPLETA") {
      janelasCompletas += 1;
      continue;
    }

    if (veredito.tipo === "SUBDIVIDIR") {
      pendentes.unshift(...veredito.partes);
      continue;
    }

    // Um dia unico ainda cheio: nao ha como estreitar mais e a API nao
    // pagina. A cobertura NAO pode ser garantida — e dizer isso e' o
    // comportamento correto.
    falhaDeCobertura = veredito.motivo;
    break;
  }

  log(`listagem: ${resumos.size} relatorio(s) na janela | ${janelasCompletas} janela(s) completa(s)`);

  // 5. O que ja conhecemos. `modified` seleciona candidatos; o hash
  //    decide depois se houve mudanca de verdade.
  const ids = [...resumos.keys()];
  let conhecidos = new Map();

  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("diario_de_obra_reports")
      .select("provider_report_id, source_modified_at")
      .eq("project_id", PROJECT_ID)
      .in("provider_report_id", ids);

    if (error) throw new Error(error.message);

    conhecidos = new Map((data ?? []).map((r) => [r.provider_report_id, r]));
  }

  const candidatos = ids.filter((id) => ehCandidato(resumos.get(id), conhecidos.get(id)));
  const teto = maxDetalhesPara(MODO);
  const selecionados = candidatos.slice(0, teto);

  log(
    `candidatos: ${candidatos.length} | detalhes nesta execucao: ${selecionados.length} (teto ${teto})`
  );

  // 6. Detalhe + upsert atomico, um RDO por vez.
  let criados = 0;
  let alterados = 0;
  let inalterados = 0;
  let erros = 0;

  for (const id of selecionados) {
    const detalhe = await api.getRelatorio(OBRA_ID, id);
    const normalizado = normalizarRelatorio(detalhe, resumos.get(id));

    const { data: resultado, error } = await supabase.rpc("upsert_diario_de_obra_report", {
      p_project_id: PROJECT_ID,
      p_sync_run_id: syncRunId,
      p_mode: MODO,
      p_provider_report_id: normalizado.providerReportId,
      p_provider_work_id: normalizado.providerWorkId || OBRA_ID,
      p_report_number: normalizado.reportNumber,
      p_reference_date: normalizado.referenceDate,
      p_reference_end_date: normalizado.referenceEndDate,
      p_weekday: normalizado.weekday,
      p_status_id: normalizado.statusId,
      p_status_label: normalizado.statusLabel,
      p_source_created_at: normalizado.sourceCreatedAt,
      p_source_modified_at: normalizado.sourceModifiedAt,
      p_content_hash: normalizado.contentHash,
      p_weather: normalizado.weather,
      p_work_hours: normalizado.workHours,
      p_labor: normalizado.labor,
      p_equipment: normalizado.equipment,
      p_materials: normalizado.materials,
      p_activities: normalizado.activities,
      p_occurrences: normalizado.occurrences,
      p_comments: normalizado.comments,
      p_checklist: normalizado.checklist,
      p_photo_count: normalizado.photoCount,
      p_video_count: normalizado.videoCount,
      p_attachment_count: normalizado.attachmentCount,
    });

    if (error) {
      // Falha num RDO nao derruba os demais e nao apaga nada: ela e'
      // contada, e a execucao termina como PARCIAL.
      erros += 1;
      log(`falha ao gravar um relatorio: ${sanitizeDiarioError(error)}`);
      continue;
    }

    if (resultado === "CRIADO") criados += 1;
    else if (resultado === "ALTERADO") alterados += 1;
    else inalterados += 1;
  }

  // 7. Checkpoint — SO agora, depois de a persistencia ter sido
  //    confirmada. Um checkpoint a frente dos dados faria a proxima
  //    execucao pular RDOs que nunca foram gravados.
  // 7. Checkpoint — SO agora, depois de a persistencia ter sido
  //    confirmada. Um checkpoint a frente dos dados faria a proxima
  //    execucao pular RDOs que nunca foram gravados.
  const candidatesRemaining = Math.max(0, candidatos.length - selecionados.length);

  const checkpoint =
    MODO === "BASELINE"
      ? montarCheckpointBaseline({
          janela: janelaInicial,
          candidatesRemaining,
          coverageGuaranteed: falhaDeCobertura === null,
          piso: pisoBaseline,
          totalNaOrigem,
        })
      : {
          modo: MODO,
          currentWindowStart: janelaInicial.inicio,
          currentWindowEnd: janelaInicial.fim,
          candidatesRemaining,
          coverageGuaranteed: falhaDeCobertura === null,
          totalNaOrigem,
        };

  const { error: erroCheckpoint } = await supabase.rpc("advance_diario_de_obra_checkpoint", {
    p_sync_run_id: syncRunId,
    p_checkpoint: checkpoint,
    p_reports_listed: resumos.size,
    p_details_requested: selecionados.length,
    p_created_count: criados,
    p_updated_count: alterados,
    p_unchanged_count: inalterados,
  });

  if (erroCheckpoint) throw new Error(erroCheckpoint.message);

  const parcial = falhaDeCobertura !== null || erros > 0;

  await supabase.rpc("finish_diario_de_obra_sync_run", {
    p_sync_run_id: syncRunId,
    p_status: parcial ? "PARCIAL" : "SUCESSO",
    p_error_count: erros,
    p_sanitized_error: falhaDeCobertura,
  });

  log(`criados ${criados} | alterados ${alterados} | inalterados ${inalterados} | erros ${erros}`);
  log(
    `checkpoint: retomar em ${checkpoint.resumeWindowEnd ?? "(fim)"} | ` +
      `restantes ${candidatesRemaining} | completo ${checkpoint.baselineComplete ?? false}`
  );
  log(`chamadas a API: ${api.totalDeChamadas} | nenhuma midia transferida | nenhum token de IA`);

  if (falhaDeCobertura) {
    log(`ATENCAO: ${falhaDeCobertura}`);
    log(`concluido em ${Date.now() - inicio}ms | status PARCIAL`);
    process.exit(1);
  }

  log(`concluido em ${Date.now() - inicio}ms | status SUCESSO`);
  process.exit(0);
} catch (erro) {
  const mensagem = sanitizeDiarioError(erro);

  if (syncRunId) {
    // Fechar a execucao como ERRO nao desfaz o que ja foi gravado: os
    // RDOs persistidos sao corretos, e o checkpoint nao avancou.
    await supabase
      .rpc("finish_diario_de_obra_sync_run", {
        p_sync_run_id: syncRunId,
        p_status: "ERRO",
        p_error_count: 1,
        p_sanitized_error: mensagem,
      })
      .catch(() => undefined);
  }

  log(`FALHA: ${mensagem}`);
  process.exit(1);
}
