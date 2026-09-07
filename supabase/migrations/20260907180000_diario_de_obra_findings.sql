-- ============================================================
-- Diario de Obra — ACHADOS DETERMINISTICOS (findings)
--
-- Um achado e' a conclusao de uma REGRA sobre um RDO. Nao e' opiniao,
-- nao e' resumo, nao e' texto gerado: e' o resultado de uma comparacao
-- aritmetica ou de enumeracao, reproduzivel a partir dos mesmos dados.
--
-- ZERO TOKEN DE LLM. Nenhuma funcao aqui chama IA, e nao ha caminho
-- deste arquivo para uma. O painel que le esta tabela declara isso na
-- tela justamente para que a ausencia seja verificavel por quem usa.
--
-- ZERO CONTEUDO. `structured_evidence` guarda NUMERO, DATA, ENUM e
-- BOOLEANO — nunca a descricao da ocorrencia, o nome de quem assinou, o
-- endereco da obra, uma URL ou um byte de midia. Isso nao e' convencao:
-- e' CHECK de banco (secao B), porque convencao se perde na proxima
-- alteracao e CHECK nao.
--
-- POR QUE O HISTORICO NAO VIRA ALERTA
--
-- Os 146 RDOs trazidos pelo baseline sao carga historica. Emitir alerta
-- retroativo sobre eles produziria uma caixa de entrada com dezenas de
-- avisos sobre os quais ninguem pode mais agir — e a licao aprendida
-- seria ignorar alertas. Baseline alimenta ESTATISTICA; alerta so nasce
-- de algo observado agora. A funcao de registro recusa modo BASELINE.
-- ============================================================


-- ============================================================
-- A. Vocabulario controlado
--
-- rule_code e severity sao CHECK, e nao tabela de dominio, de
-- proposito: criar uma regra nova passa a exigir uma migration, e
-- portanto uma revisao humana. Regra nova nao entra por INSERT.
--
--   CLIMA_IMPRATICAVEL_1_TURNO   um turno impraticavel        MEDIO
--   CLIMA_IMPRATICAVEL_2_TURNOS  dois ou mais turnos          ALTO
--   EFETIVO_ZERO_COM_ATIVIDADE   efetivo zero com atividade   MEDIO
--   ATIVIDADE_100_SEM_CONCLUSAO  100% sem status concluida    MEDIO
--   OCORRENCIA_REGISTRADA        ocorrencia estruturada       MEDIO (revisao humana)
--   EDICAO_TARDIA                editado 30+ dias depois      MEDIO
--   RDO_SEM_FOTO                 nenhuma foto no RDO          BAIXO
--   NUMERO_DUPLICADO             numero repetido na serie     ALTO
--   DATA_DUPLICADA               data repetida na serie       ALTO
--   SALTO_DE_NUMERACAO           lacuna na numeracao          ALTO
--   HASH_ALTERADO_POS_BASELINE   conteudo mudou apos baseline MEDIO
-- ============================================================

create table if not exists public.diario_de_obra_findings (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  -- CASCADE: um achado sem o RDO que o originou nao e' auditavel.
  report_id uuid not null
    references public.diario_de_obra_reports (id) on delete cascade,

  -- RESTRICT: o achado sempre aponta para a execucao que o observou.
  -- Apagar a execucao apagaria a resposta de "quando isto apareceu".
  sync_run_id uuid not null
    references public.diario_de_obra_sync_runs (id) on delete restrict,

  rule_code text not null
    check (rule_code in (
      'CLIMA_IMPRATICAVEL_1_TURNO',
      'CLIMA_IMPRATICAVEL_2_TURNOS',
      'EFETIVO_ZERO_COM_ATIVIDADE',
      'ATIVIDADE_100_SEM_CONCLUSAO',
      'OCORRENCIA_REGISTRADA',
      'EDICAO_TARDIA',
      'RDO_SEM_FOTO',
      'NUMERO_DUPLICADO',
      'DATA_DUPLICADA',
      'SALTO_DE_NUMERACAO',
      'HASH_ALTERADO_POS_BASELINE'
    )),

  severity text not null
    check (severity in ('BAIXO', 'MEDIO', 'ALTO')),

  status text not null default 'OPEN'
    check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),

  -- Chave estavel do achado dentro da regra. Deterministica e derivada
  -- de IDENTIFICADORES (provider_report_id, indice, numero), nunca do
  -- conteudo: e' o que torna a reavaliacao idempotente.
  evidence_key text not null,

  -- sha256 da evidencia estruturada. Quando ele muda, o achado mudou de
  -- fato, e um achado ja RESOLVED volta a OPEN — reabrir por evidencia
  -- nova e' correto; reabrir pela mera reexecucao seria ruido.
  evidence_hash text not null,

  -- SO numero, data, enum e booleano. O CHECK da secao B recusa
  -- qualquer texto com espaco, ':', '/', '@' ou mais de 40 caracteres —
  -- forma que descricao, nome, endereco e URL nao conseguem assumir.
  structured_evidence jsonb not null default '{}'::jsonb,

  -- O achado APONTA; quem conclui e' humano. Verdadeiro nas regras cuja
  -- leitura depende de contexto de obra (ocorrencia registrada, por
  -- exemplo), onde o sistema nao tem — e nao deve ter — a decisao.
  requires_human_review boolean not null default false,

  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- IDEMPOTENCIA. Reavaliar o mesmo RDO na mesma condicao nao cria uma
  -- segunda linha: atualiza a existente. A execucao NAO entra na chave,
  -- de proposito — se entrasse, cada run produziria um achado novo para
  -- a mesma condicao e o painel contaria a mesma coisa muitas vezes.
  constraint diario_de_obra_findings_identidade
    unique (project_id, rule_code, evidence_key),

  constraint diario_de_obra_findings_hash_format
    check (evidence_hash ~ '^[0-9a-f]{64}$'),

  constraint diario_de_obra_findings_evidence_key_format
    check (evidence_key ~ '^[A-Za-z0-9_.:-]{1,120}$'),

  -- Coerencia do ciclo de vida: RESOLVED tem data, os outros nao.
  constraint diario_de_obra_findings_resolucao_coerente
    check (
      (status = 'RESOLVED' and resolved_at is not null)
      or (status <> 'RESOLVED' and resolved_at is null)
    )
);

create index if not exists diario_de_obra_findings_project_status_idx
  on public.diario_de_obra_findings (project_id, status, severity);

create index if not exists diario_de_obra_findings_report_idx
  on public.diario_de_obra_findings (report_id);

create index if not exists diario_de_obra_findings_run_idx
  on public.diario_de_obra_findings (sync_run_id);


-- ============================================================
-- B. A evidencia nao pode carregar conteudo — CHECK, nao convencao
--
-- A funcao percorre o JSONB inteiro e recusa qualquer STRING que nao
-- caiba na forma de identificador, enum ou data. Numero e booleano
-- passam livres. Chaves seguem a mesma regra: um nome proprio usado
-- como CHAVE vazaria tanto quanto usado como valor.
--
-- IMMUTABLE porque um CHECK exige isso; ela so olha o proprio argumento.
-- ============================================================

create or replace function public.diario_de_obra_evidencia_sem_conteudo(p_evidencia jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_chave text;
  v_item jsonb;
begin
  if p_evidencia is null then
    return true;
  end if;

  case jsonb_typeof(p_evidencia)
    when 'string' then
      -- Sem espaco, sem ':', sem '/', sem '@', no maximo 40 caracteres.
      -- Descricao de ocorrencia, nome de pessoa, endereco e URL nao
      -- passam por esse funil; 'MEDIO', '2026-09-07' e um ObjectId sim.
      return (p_evidencia #>> '{}') ~ '^[A-Za-z0-9_.-]{0,40}$';

    when 'number' then
      return true;

    when 'boolean' then
      return true;

    when 'null' then
      return true;

    when 'array' then
      for v_item in select value from jsonb_array_elements(p_evidencia)
      loop
        if not public.diario_de_obra_evidencia_sem_conteudo(v_item) then
          return false;
        end if;
      end loop;
      return true;

    when 'object' then
      for v_chave in select jsonb_object_keys(p_evidencia)
      loop
        if v_chave !~ '^[A-Za-z0-9_]{1,40}$' then
          return false;
        end if;

        if not public.diario_de_obra_evidencia_sem_conteudo(p_evidencia -> v_chave) then
          return false;
        end if;
      end loop;
      return true;

    else
      return false;
  end case;
end;
$$;

alter table public.diario_de_obra_findings
  drop constraint if exists diario_de_obra_findings_evidencia_sem_conteudo;

alter table public.diario_de_obra_findings
  add constraint diario_de_obra_findings_evidencia_sem_conteudo
  check (public.diario_de_obra_evidencia_sem_conteudo(structured_evidence));


-- ============================================================
-- C. RLS
--
-- Leitura para membro do projeto, pela mesma funcao que ja governa o
-- resto do modulo. NENHUMA politica de insert, update ou delete: a
-- escrita passa so pelas funcoes SECURITY DEFINER da secao D, que
-- apenas service_role executa. Um membro do projeto pode LER um achado
-- e nunca fabricar ou apagar um.
-- ============================================================

alter table public.diario_de_obra_findings enable row level security;

drop policy if exists "diario_de_obra_findings_select_members"
  on public.diario_de_obra_findings;
create policy "diario_de_obra_findings_select_members"
  on public.diario_de_obra_findings
  for select
  using (public.is_project_member(project_id));


-- ============================================================
-- D. Registrar UM achado — idempotente
--
-- Mesma condicao reavaliada => a MESMA linha, com last_detected_at
-- avancado. Nunca uma segunda.
--
-- Transicoes:
--   inexistente                  -> OPEN
--   OPEN / ACKNOWLEDGED          -> mantem o status; so o carimbo anda
--   RESOLVED                     -> reabre em OPEN
--
-- Reabrir SEMPRE que um RESOLVED e' redetectado nao produz ruido, e a
-- razao esta na secao E: um achado so vira RESOLVED quando a regra
-- DEIXA de aponta-lo. Logo, ve-lo de novo significa que a condicao
-- voltou a existir na obra — o clima voltou a ser impraticavel, a foto
-- foi removida de novo. Deixa-lo resolvido esconderia um fato atual
-- porque uma versao anterior dele ja foi tratada.
--
-- Manter ACKNOWLEDGED e' deliberado, e diferente: alguem ja viu aquilo
-- e assumiu, e rebaixar para OPEN a cada execucao apagaria esse
-- trabalho. ACKNOWLEDGED e' o estado para "sei disso"; RESOLVED e' o
-- estado para "nao acontece mais".
--
-- BASELINE e' recusado. Carga historica nao gera alerta.
-- ============================================================

create or replace function public.register_diario_de_obra_finding(
  p_project_id uuid,
  p_report_id uuid,
  p_sync_run_id uuid,
  p_mode text,
  p_rule_code text,
  p_severity text,
  p_evidence_key text,
  p_evidence_hash text,
  p_structured_evidence jsonb,
  p_requires_human_review boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existente public.diario_de_obra_findings%rowtype;
  v_now timestamptz := now();
begin
  if p_mode = 'BASELINE' then
    raise exception 'Carga BASELINE nao gera achado: historico alimenta estatistica, nao alerta.';
  end if;

  if not public.diario_de_obra_evidencia_sem_conteudo(p_structured_evidence) then
    raise exception 'Evidencia recusada: so numero, data, enum e booleano sao aceitos.';
  end if;

  -- FOR UPDATE: duas execucoes concorrentes sobre o mesmo achado nao
  -- podem ambas concluir que ele e' novo.
  select *
    into v_existente
    from public.diario_de_obra_findings
   where project_id = p_project_id
     and rule_code = p_rule_code
     and evidence_key = p_evidence_key
   for update;

  if not found then
    insert into public.diario_de_obra_findings (
      project_id, report_id, sync_run_id,
      rule_code, severity, status,
      evidence_key, evidence_hash, structured_evidence,
      requires_human_review,
      first_detected_at, last_detected_at, resolved_at,
      created_at, updated_at
    )
    values (
      p_project_id, p_report_id, p_sync_run_id,
      p_rule_code, p_severity, 'OPEN',
      p_evidence_key, p_evidence_hash,
      coalesce(p_structured_evidence, '{}'::jsonb),
      coalesce(p_requires_human_review, false),
      v_now, v_now, null,
      v_now, v_now
    );

    return 'CRIADO';
  end if;

  if v_existente.status = 'RESOLVED' then
    update public.diario_de_obra_findings
       set status = 'OPEN',
           resolved_at = null,
           severity = p_severity,
           evidence_hash = p_evidence_hash,
           structured_evidence = coalesce(p_structured_evidence, '{}'::jsonb),
           requires_human_review = coalesce(p_requires_human_review, false),
           sync_run_id = p_sync_run_id,
           last_detected_at = v_now,
           updated_at = v_now
     where id = v_existente.id;

    return 'REABERTO';
  end if;

  update public.diario_de_obra_findings
     set severity = p_severity,
         evidence_hash = p_evidence_hash,
         structured_evidence = coalesce(p_structured_evidence, '{}'::jsonb),
         requires_human_review = coalesce(p_requires_human_review, false),
         sync_run_id = p_sync_run_id,
         last_detected_at = v_now,
         updated_at = v_now
   where id = v_existente.id;

  return case
    when v_existente.evidence_hash = p_evidence_hash then 'INALTERADO'
    else 'ATUALIZADO'
  end;
end;
$$;


-- ============================================================
-- E. Resolver o que a regra deixou de apontar
--
-- Chamada UMA vez por RDO reavaliado, com a lista do que ainda vale. O
-- que estava aberto e nao esta na lista foi corrigido na origem — vira
-- RESOLVED, com data.
--
-- A lista chega como `RULE_CODE|evidence_key`, e nao so a chave. O
-- motivo e' concreto: `evidence_key` e' o proprio RDO na maioria das
-- regras, entao varios achados do mesmo RDO compartilham a chave.
-- Comparar so por ela faria "clima ainda impraticavel" manter vivo um
-- "RDO sem foto" que ja nao existe mais. `|` como separador porque
-- rule_code e evidence_key nao podem conte-lo.
--
-- Escopo por RDO e' essencial: resolver por execucao encerraria achados
-- de RDOs que aquela execucao sequer olhou. Um RDO fora da janela nao
-- foi avaliado, e nao avaliar nao e' o mesmo que estar resolvido.
--
-- RESOLVED e' reversivel: se a condicao voltar, a secao D reabre.
-- ============================================================

create or replace function public.resolve_diario_de_obra_findings(
  p_project_id uuid,
  p_report_id uuid,
  p_achados_ativos text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolvidos integer;
begin
  update public.diario_de_obra_findings
     set status = 'RESOLVED',
         resolved_at = now(),
         updated_at = now()
   where project_id = p_project_id
     and report_id = p_report_id
     and status in ('OPEN', 'ACKNOWLEDGED')
     and not (
       (rule_code || '|' || evidence_key)
         = any (coalesce(p_achados_ativos, array[]::text[]))
     );

  get diagnostics v_resolvidos = row_count;

  return v_resolvidos;
end;
$$;


-- ============================================================
-- F. Grants
--
-- Nenhuma funcao daqui e' alcancavel por sessao de usuario. Dar isto a
-- `authenticated` permitiria a um membro do projeto fabricar ou apagar
-- achado — e um achado fabricado destroi a utilidade de todos os
-- outros.
-- ============================================================

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.register_diario_de_obra_finding(uuid, uuid, uuid, text, text, text, text, text, jsonb, boolean)',
    'public.resolve_diario_de_obra_findings(uuid, uuid, text[])'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;


-- ============================================================
-- G. Superficie de leitura do painel
--
-- O painel precisa de AGREGADOS: quantos RDOs, quantos sem foto, qual a
-- faixa historica, quantas ocorrencias. Ele nao precisa — e nao pode
-- receber — a descricao da ocorrencia, o nome de quem assinou ou o
-- endereco da frente de servico.
--
-- Por isso a tela nao le `diario_de_obra_reports` diretamente. Ela le
-- esta view, que converte as colecoes de texto em CONTAGEM antes de
-- qualquer coisa sair do banco. `ocorrencias` e `atividades` viram
-- numero aqui dentro; a descricao nunca atravessa a fronteira.
--
-- `clima` e `maoDeObra` seguem como estao porque a mediana de efetivo e
-- a contagem de turnos impraticaveis dependem da forma do documento, que
-- varia por modelo de relatorio. Eles ja chegam sem URL e sem log — a
-- normalizacao da ingestao remove isso antes de gravar — e o leitor do
-- painel os reduz a numero antes de devolver a qualquer componente.
--
-- security_invoker: a view roda com os privilegios de quem consulta,
-- entao a RLS de diario_de_obra_reports (membros do projeto) continua
-- valendo. Sem isso a view furaria a RLS.
-- ============================================================

create or replace view public.diario_de_obra_report_metrics
with (security_invoker = true)
as
  select
    r.id as report_id,
    r.project_id,
    r.report_number,
    r.reference_date,
    r.source_created_at,
    r.source_modified_at,
    r.baseline_imported,
    r.photo_count,
    case
      when jsonb_typeof(r.occurrences) = 'array' then jsonb_array_length(r.occurrences)
      else 0
    end as occurrence_count,
    case
      when jsonb_typeof(r.activities) = 'array' then jsonb_array_length(r.activities)
      else 0
    end as activity_count,
    r.weather,
    r.labor
  from public.diario_de_obra_reports r;

grant select on public.diario_de_obra_report_metrics to authenticated;
