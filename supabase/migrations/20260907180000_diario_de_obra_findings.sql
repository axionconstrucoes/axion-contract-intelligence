-- ============================================================
-- Diario de Obra — ACHADOS DETERMINISTICOS (findings)
--
-- Um achado e' a conclusao de uma REGRA sobre um RDO ou sobre a SERIE.
-- Nao e' opiniao, nao e' resumo, nao e' texto gerado: e' o resultado de
-- uma comparacao aritmetica ou de enumeracao fechada, reproduzivel a
-- partir dos mesmos dados.
--
-- ZERO TOKEN DE LLM. Nenhuma funcao aqui chama IA, e nao ha caminho
-- deste arquivo para uma.
--
-- ZERO CONTEUDO. `structured_evidence` segue um SCHEMA FECHADO por
-- regra (secao B): cada regra declara suas chaves, e cada chave tem um
-- tipo — inteiro, booleano, data ISO, codigo de categoria, prefixo de
-- hash ou ObjectId. Nao existe campo de texto livre, entao descricao,
-- nome, endereco, URL, JWT, cookie e token nao tem onde caber.
--
-- POR QUE NAO E' MAIS UM REGEX
--
-- A primeira versao aceitava qualquer string que casasse
-- `^[A-Za-z0-9_.-]{0,40}$` — que e' exatamente o alfabeto do base64url.
-- Um JWT truncado em 40 caracteres passava, e tambem um UUID de sessao e
-- uma chave hex de 32. O funil media a FORMA do texto quando o que
-- importa e' QUE CAMPO ele ocupa.
--
-- POR QUE O HISTORICO NAO VIRA ALERTA
--
-- Os 146 RDOs trazidos pelo baseline sao carga historica. A funcao de
-- registro recusa o modo BASELINE: alerta so nasce de algo observado
-- agora.
-- ============================================================


-- ============================================================
-- A. Vocabulario controlado
--
-- rule_code, severity e category_code sao CHECK, e nao tabela de
-- dominio, de proposito: criar uma regra ou categoria nova passa a
-- exigir uma migration, e portanto uma revisao humana.
--
--   CLIMA_IMPRATICAVEL_1_TURNO   um turno impraticavel        MEDIO
--   CLIMA_IMPRATICAVEL_2_TURNOS  dois ou mais turnos          ALTO
--   EFETIVO_ZERO_COM_ATIVIDADE   efetivo zero com atividade   MEDIO
--   ATIVIDADE_100_SEM_CONCLUSAO  100% sem status concluida    MEDIO
--   OCORRENCIA_REGISTRADA        ocorrencia estruturada       DERIVADA
--   EDICAO_TARDIA                editado 30+ dias depois      MEDIO
--   RDO_SEM_FOTO                 nenhuma foto no RDO          BAIXO
--   NUMERO_DUPLICADO             numero repetido na serie     ALTO
--   DATA_DUPLICADA               data repetida na serie       ALTO
--   SALTO_DE_NUMERACAO           lacuna na numeracao          ALTO
--   HASH_ALTERADO_POS_BASELINE   conteudo mudou apos baseline MEDIO
-- ============================================================


-- ------------------------------------------------------------
-- A.1 Severidade da CATEGORIA de ocorrencia
--
-- As 24 categorias do formulario do Diario de Obra. A severidade vem da
-- categoria que o apontador escolheu — nunca da descricao que ele
-- escreveu. Categoria fora da lista e' UNKNOWN: MEDIO e revisao humana,
-- sem guardar o rotulo livre.
--
-- Nenhuma categoria produz CRITICO. O teto e' ALTO.
-- ------------------------------------------------------------

create or replace function public.diario_de_obra_severidade_da_categoria(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_code in (
      'ADITIVOS',
      'ALTERACAO_DE_PROJETO',
      'DANO_EM_ESTRUTURA_EXISTENTE',
      'DANO_EM_ESTRUTURA_NOVA',
      'DIA_PARADO',
      'FISCALIZACAO_TRABALHISTA_AMBIENTAL',
      'SOLICITACAO_FORA_DO_ESCOPO',
      'TALUDE_DANIFICADO_POR_CHUVA'
    ) then 'ALTO'

    when p_code in (
      'AGENTES_EXTERNOS',
      'CRONOGRAMA',
      'FALHA_MECANICA_DE_EQUIPAMENTO',
      'FALTA_DE_EQUIPAMENTO',
      'FALTA_DE_MATERIAL',
      'FALTA_DE_MAO_DE_OBRA',
      'IDENTIFICACAO_DE_ERRO_DE_PROJETO',
      'INCOMPATIBILIDADE_DE_PROJETOS',
      'RETRABALHO',
      'SOLICITACOES_DO_CLIENTE',
      'VISITA_DO_FISCAL',
      'VISITA_SEGURADORA'
    ) then 'MEDIO'

    when p_code in (
      'DIA_CHUVOSO',
      'LIBERACAO_DE_MEDICAO',
      'REUNIAO',
      'VISITA_DO_PROJETISTA'
    ) then 'BAIXO'

    -- Categoria que o fornecedor criou depois desta migration. MEDIO
    -- porque nao se sabe, e revisao humana pelo mesmo motivo.
    when p_code = 'UNKNOWN' then 'MEDIO'

    else null
  end;
$$;


-- ------------------------------------------------------------
-- A.2 Severidade ESPERADA de um achado
--
-- E' esta funcao que impede um chamador de gravar severidade
-- arbitraria: a coluna `severity` e' validada por CHECK contra ela, e a
-- RPC a recalcula. Nem service_role escrevendo direto na tabela
-- consegue marcar "RDO sem foto" como ALTO.
-- ------------------------------------------------------------

create or replace function public.diario_de_obra_severidade_esperada(
  p_rule_code text,
  p_category_code text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_rule_code
    when 'OCORRENCIA_REGISTRADA' then public.diario_de_obra_severidade_da_categoria(p_category_code)
    when 'CLIMA_IMPRATICAVEL_1_TURNO' then 'MEDIO'
    when 'CLIMA_IMPRATICAVEL_2_TURNOS' then 'ALTO'
    when 'EFETIVO_ZERO_COM_ATIVIDADE' then 'MEDIO'
    when 'ATIVIDADE_100_SEM_CONCLUSAO' then 'MEDIO'
    when 'EDICAO_TARDIA' then 'MEDIO'
    when 'RDO_SEM_FOTO' then 'BAIXO'
    when 'NUMERO_DUPLICADO' then 'ALTO'
    when 'DATA_DUPLICADA' then 'ALTO'
    when 'SALTO_DE_NUMERACAO' then 'ALTO'
    when 'HASH_ALTERADO_POS_BASELINE' then 'MEDIO'
    else null
  end;
$$;


-- ------------------------------------------------------------
-- A.3 Quais regras sao da SERIE
--
-- Existe para que as duas funcoes de resolucao nao se atropelem: a
-- resolucao por RDO ignora as regras de serie, e a de serie ignora as
-- de RDO. Sem essa separacao, resolver um RDO encerraria a duplicidade
-- de numeracao do projeto inteiro.
-- ------------------------------------------------------------

create or replace function public.diario_de_obra_regras_de_serie()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['NUMERO_DUPLICADO', 'DATA_DUPLICADA', 'SALTO_DE_NUMERACAO'];
$$;


-- ============================================================
-- B. SCHEMA FECHADO da evidencia
--
-- Duas tabelas: as chaves que cada regra aceita, e o tipo de cada nome
-- de chave. O nome carrega o tipo — `diasApos` e' inteiro em qualquer
-- regra, `data` e' data ISO em qualquer regra —, o que permite validar
-- sem repetir o esquema inteiro por regra. O modulo TypeScript
-- `finding-evidence.ts` declara exatamente o mesmo contrato e falha
-- antes, com mensagem util.
-- ============================================================

create or replace function public.diario_de_obra_chaves_da_regra(p_rule_code text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_rule_code
    when 'CLIMA_IMPRATICAVEL_1_TURNO' then array['turnosImpraticaveis']
    when 'CLIMA_IMPRATICAVEL_2_TURNOS' then array['turnosImpraticaveis']
    when 'EFETIVO_ZERO_COM_ATIVIDADE' then array['efetivo', 'atividades']
    when 'ATIVIDADE_100_SEM_CONCLUSAO' then array['atividades']
    when 'OCORRENCIA_REGISTRADA' then array['categoria', 'ocorrencias', 'tipoId', 'tipoRef']
    when 'EDICAO_TARDIA' then array['diasApos', 'dataReferencia', 'dataEdicao']
    when 'RDO_SEM_FOTO' then array['fotos']
    when 'NUMERO_DUPLICADO' then array['numero', 'ocorrencias']
    when 'DATA_DUPLICADA' then array['data', 'ocorrencias']
    when 'SALTO_DE_NUMERACAO' then array['numeroAnterior', 'numero', 'faltando']
    when 'HASH_ALTERADO_POS_BASELINE' then array['baselineImportado', 'hashPrefixo']
    else null
  end;
$$;

create or replace function public.diario_de_obra_chaves_obrigatorias(p_rule_code text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_rule_code
    -- `tipoId` e `tipoRef` sao opcionais: a API nem sempre devolve o
    -- identificador estruturado do tipo.
    when 'OCORRENCIA_REGISTRADA' then array['categoria', 'ocorrencias']
    else public.diario_de_obra_chaves_da_regra(p_rule_code)
  end;
$$;

create or replace function public.diario_de_obra_e_inteiro(p_valor jsonb, p_nao_negativo boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_valor) = 'number'
    and (p_valor #>> '{}') ~ '^-?[0-9]+$'
    and (not p_nao_negativo or (p_valor #>> '{}')::numeric >= 0);
$$;

/*
 * Tipo por NOME de chave.
 *
 * `tipoRef` e' o UNICO campo que aceita ObjectId. Uma cadeia de 24
 * hexadecimais e' indistinguivel de meia chave de API, entao o tipo so
 * vale onde o formato foi de fato acordado com o fornecedor.
 */
create or replace function public.diario_de_obra_valor_de_evidencia_valido(
  p_chave text,
  p_valor jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_chave
    when 'turnosImpraticaveis' then public.diario_de_obra_e_inteiro(p_valor, true)
    when 'efetivo' then public.diario_de_obra_e_inteiro(p_valor, true)
    when 'atividades' then public.diario_de_obra_e_inteiro(p_valor, true)
    when 'ocorrencias' then public.diario_de_obra_e_inteiro(p_valor, true)
    when 'fotos' then public.diario_de_obra_e_inteiro(p_valor, true)
    when 'diasApos' then public.diario_de_obra_e_inteiro(p_valor, true)
    when 'faltando' then public.diario_de_obra_e_inteiro(p_valor, true)
    when 'tipoId' then public.diario_de_obra_e_inteiro(p_valor, true)
    when 'numero' then public.diario_de_obra_e_inteiro(p_valor, false)
    when 'numeroAnterior' then public.diario_de_obra_e_inteiro(p_valor, false)

    when 'baselineImportado' then jsonb_typeof(p_valor) = 'boolean'

    when 'data' then jsonb_typeof(p_valor) = 'string'
      and (p_valor #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
    when 'dataReferencia' then jsonb_typeof(p_valor) = 'string'
      and (p_valor #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
    when 'dataEdicao' then jsonb_typeof(p_valor) = 'string'
      and (p_valor #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'

    when 'categoria' then jsonb_typeof(p_valor) = 'string'
      and public.diario_de_obra_severidade_da_categoria(p_valor #>> '{}') is not null

    when 'hashPrefixo' then jsonb_typeof(p_valor) = 'string'
      and (p_valor #>> '{}') ~ '^[0-9a-f]{12}$'

    when 'tipoRef' then jsonb_typeof(p_valor) = 'string'
      and (p_valor #>> '{}') ~ '^[a-f0-9]{24}$'

    else false
  end;
$$;

/*
 * A validacao completa: regra conhecida, nenhuma chave extra, nenhuma
 * chave obrigatoria ausente, todo valor no tipo declarado.
 */
create or replace function public.diario_de_obra_evidencia_valida(
  p_rule_code text,
  p_evidencia jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_permitidas text[];
  v_obrigatorias text[];
  v_chave text;
begin
  v_permitidas := public.diario_de_obra_chaves_da_regra(p_rule_code);

  -- Regra sem esquema declarado nao grava evidencia nenhuma.
  if v_permitidas is null then
    return false;
  end if;

  if p_evidencia is null or jsonb_typeof(p_evidencia) <> 'object' then
    return false;
  end if;

  for v_chave in select jsonb_object_keys(p_evidencia)
  loop
    if not (v_chave = any (v_permitidas)) then
      return false;
    end if;

    if not public.diario_de_obra_valor_de_evidencia_valido(v_chave, p_evidencia -> v_chave) then
      return false;
    end if;
  end loop;

  v_obrigatorias := public.diario_de_obra_chaves_obrigatorias(p_rule_code);

  foreach v_chave in array v_obrigatorias
  loop
    if not jsonb_exists(p_evidencia, v_chave) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;


-- ============================================================
-- C. Chave composta no relatorio
--
-- Necessaria para a FK composta da secao D: sem ela, nada garante que o
-- `report_id` de um achado pertence ao `project_id` do achado. `id` ja
-- e' chave primaria, entao esta unicidade e' gratuita — ela existe so
-- para ser o alvo da FK.
-- ============================================================

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'diario_de_obra_reports_id_project_key'
       and conrelid = 'public.diario_de_obra_reports'::regclass
  ) then
    alter table public.diario_de_obra_reports
      add constraint diario_de_obra_reports_id_project_key unique (id, project_id);
  end if;
end;
$$;


-- ============================================================
-- D. A tabela
-- ============================================================

create table if not exists public.diario_de_obra_findings (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  -- Sem FK simples: a FK COMPOSTA abaixo garante, no banco, que o RDO
  -- pertence ao mesmo projeto do achado. Um achado do projeto A
  -- apontando para um RDO do projeto B seria um vazamento entre
  -- projetos que a RLS nao pegaria — a RLS filtra por `project_id`, e o
  -- `project_id` estaria "certo".
  report_id uuid not null,

  -- NULLABLE, com SET NULL. A versao anterior usava RESTRICT, e isso
  -- fazia a exclusao de um projeto FALHAR: o cascade de `projects`
  -- apaga `sync_runs` e `findings` na mesma instrucao, e RESTRICT e'
  -- verificado de imediato, sem esperar o fim. Preservar o vinculo
  -- quando ele existe e perde-lo quando a execucao some e' melhor que
  -- travar a exclusao do projeto.
  sync_run_id uuid
    references public.diario_de_obra_sync_runs (id) on delete set null,

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

  -- Categoria estruturada da ocorrencia. NULL em toda outra regra — o
  -- CHECK de coerencia abaixo garante os dois lados disso.
  category_code text,

  severity text not null
    check (severity in ('BAIXO', 'MEDIO', 'ALTO')),

  status text not null default 'OPEN'
    check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),

  -- Chave estavel do achado dentro da regra.
  --
  --   regras de RDO     `<provider_report_id>`
  --   ocorrencia        `<provider_report_id>:<CATEGORIA>[:<tipo>]`
  --   numero duplicado  `NUM-<numero>`
  --   data duplicada    `DATA-<AAAA-MM-DD>`
  --   salto             `SALTO-<primeiro>-<ultimo>`
  --
  -- Nas regras de serie a chave e' o FATO, e nao o RDO: "o numero 11
  -- esta duplicado" e' um unico achado, mesmo com tres RDOs envolvidos.
  evidence_key text not null,

  -- sha256 da evidencia estruturada. Distingue "o mesmo achado de novo"
  -- de "o achado mudou".
  evidence_hash text not null,

  -- SCHEMA FECHADO por regra — ver secao B.
  structured_evidence jsonb not null default '{}'::jsonb,

  -- O achado APONTA; quem conclui e' humano. Obrigatorio quando a
  -- categoria e' desconhecida: o sistema nao sabe o que aquilo
  -- significa, e afirmar que sabe seria pior que admitir que nao.
  requires_human_review boolean not null default false,

  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- IDEMPOTENCIA. Reavaliar a mesma condicao nao cria uma segunda
  -- linha. A execucao NAO entra na chave: se entrasse, cada run
  -- produziria um achado novo para a mesma condicao.
  constraint diario_de_obra_findings_identidade
    unique (project_id, rule_code, evidence_key),

  -- O RDO ancora tem de ser do MESMO projeto do achado.
  constraint diario_de_obra_findings_report_do_projeto
    foreign key (report_id, project_id)
    references public.diario_de_obra_reports (id, project_id)
    on delete cascade,

  constraint diario_de_obra_findings_hash_format
    check (evidence_hash ~ '^[0-9a-f]{64}$'),

  constraint diario_de_obra_findings_evidence_key_format
    check (evidence_key ~ '^[A-Za-z0-9_.:-]{1,120}$'),

  -- category_code existe se, e somente se, a regra e' de ocorrencia.
  constraint diario_de_obra_findings_categoria_coerente
    check (
      (rule_code = 'OCORRENCIA_REGISTRADA' and category_code is not null)
      or (rule_code <> 'OCORRENCIA_REGISTRADA' and category_code is null)
    ),

  -- A combinacao (regra, categoria) tem de ser CONHECIDA. Sem isto, uma
  -- categoria inventada faria `severidade_esperada` devolver NULL, o
  -- CHECK abaixo avaliaria NULL — e em SQL um CHECK nulo PASSA. O buraco
  -- seria exatamente por onde uma categoria fora da taxonomia entraria.
  constraint diario_de_obra_findings_categoria_conhecida
    check (public.diario_de_obra_severidade_esperada(rule_code, category_code) is not null),

  -- SEVERIDADE NAO E' ESCOLHA DO CHAMADOR. Ela e' funcao de
  -- (rule_code, category_code), e o banco recusa qualquer outra.
  constraint diario_de_obra_findings_severidade_derivada
    check (severity = public.diario_de_obra_severidade_esperada(rule_code, category_code)),

  -- Categoria desconhecida sempre vai para revisao humana.
  constraint diario_de_obra_findings_desconhecida_revisada
    check (category_code is distinct from 'UNKNOWN' or requires_human_review),

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

-- O CHECK da evidencia depende de duas colunas, entao vem por ALTER.
alter table public.diario_de_obra_findings
  drop constraint if exists diario_de_obra_findings_evidencia_valida;

alter table public.diario_de_obra_findings
  add constraint diario_de_obra_findings_evidencia_valida
  check (public.diario_de_obra_evidencia_valida(rule_code, structured_evidence));


-- ============================================================
-- E. RLS
--
-- Leitura para membro do projeto, pela mesma funcao que ja governa o
-- resto do modulo. NENHUMA politica de insert, update ou delete: a
-- escrita passa so pelas funcoes SECURITY DEFINER, que apenas
-- service_role executa. Um membro do projeto pode LER um achado e nunca
-- fabricar, alterar ou apagar um.
-- ============================================================

alter table public.diario_de_obra_findings enable row level security;

drop policy if exists "diario_de_obra_findings_select_members"
  on public.diario_de_obra_findings;
create policy "diario_de_obra_findings_select_members"
  on public.diario_de_obra_findings
  for select
  using (public.is_project_member(project_id));


-- ============================================================
-- F. Registrar UM achado — idempotente
--
-- Mesma condicao reavaliada => a MESMA linha, com last_detected_at
-- avancado. Nunca uma segunda.
--
-- Transicoes:
--   inexistente                  -> OPEN
--   OPEN / ACKNOWLEDGED          -> mantem o status; so o carimbo anda
--   RESOLVED                     -> reabre em OPEN
--
-- Reabrir sempre que um RESOLVED e' redetectado nao produz ruido: um
-- achado so vira RESOLVED quando a regra DEIXA de aponta-lo, entao
-- ve-lo de novo significa que a condicao voltou a existir na obra.
--
-- ACKNOWLEDGED e' diferente e sobrevive: alguem ja viu aquilo e
-- assumiu, e rebaixar para OPEN a cada execucao apagaria esse trabalho.
--
-- A SEVERIDADE E' DERIVADA AQUI DENTRO. `p_severity` continua no
-- contrato para que um chamador desalinhado seja RECUSADO com erro
-- claro, em vez de gravar em silencio algo que o CHECK depois negaria.
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
  p_requires_human_review boolean default false,
  p_category_code text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existente public.diario_de_obra_findings%rowtype;
  v_now timestamptz := now();
  v_severidade text;
  v_revisao boolean;
begin
  if p_mode = 'BASELINE' then
    raise exception 'Carga BASELINE nao gera achado: historico alimenta estatistica, nao alerta.';
  end if;

  -- Modo desconhecido nao passa. Antes, qualquer cadeia diferente de
  -- 'BASELINE' era aceita — um erro de digitacao gravava achado.
  if p_mode is null or p_mode not in ('INCREMENTAL', 'RECONCILE') then
    raise exception 'Modo invalido para registro de achado.';
  end if;

  v_severidade := public.diario_de_obra_severidade_esperada(p_rule_code, p_category_code);

  if v_severidade is null then
    raise exception 'Regra ou categoria desconhecida no registro de achado.';
  end if;

  if p_severity is not null and p_severity <> v_severidade then
    raise exception 'Severidade incompativel com a regra: a severidade e derivada, nao escolhida.';
  end if;

  if not public.diario_de_obra_evidencia_valida(p_rule_code, p_structured_evidence) then
    raise exception 'Evidencia recusada: fora do schema fechado da regra.';
  end if;

  -- O RDO ancora tem de existir no MESMO projeto. A FK composta ja
  -- garante isso; a checagem aqui devolve mensagem util em vez de erro
  -- de constraint.
  if not exists (
    select 1
      from public.diario_de_obra_reports r
     where r.id = p_report_id
       and r.project_id = p_project_id
  ) then
    raise exception 'RDO ancora inexistente ou de outro projeto.';
  end if;

  v_revisao := coalesce(p_requires_human_review, false)
    or p_category_code is not distinct from 'UNKNOWN';

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
      rule_code, category_code, severity, status,
      evidence_key, evidence_hash, structured_evidence,
      requires_human_review,
      first_detected_at, last_detected_at, resolved_at,
      created_at, updated_at
    )
    values (
      p_project_id, p_report_id, p_sync_run_id,
      p_rule_code, p_category_code, v_severidade, 'OPEN',
      p_evidence_key, p_evidence_hash,
      coalesce(p_structured_evidence, '{}'::jsonb),
      v_revisao,
      v_now, v_now, null,
      v_now, v_now
    );

    return 'CRIADO';
  end if;

  if v_existente.status = 'RESOLVED' then
    update public.diario_de_obra_findings
       set status = 'OPEN',
           resolved_at = null,
           report_id = p_report_id,
           severity = v_severidade,
           evidence_hash = p_evidence_hash,
           structured_evidence = coalesce(p_structured_evidence, '{}'::jsonb),
           requires_human_review = v_revisao,
           sync_run_id = p_sync_run_id,
           last_detected_at = v_now,
           updated_at = v_now
     where id = v_existente.id;

    return 'REABERTO';
  end if;

  update public.diario_de_obra_findings
     set report_id = p_report_id,
         severity = v_severidade,
         evidence_hash = p_evidence_hash,
         structured_evidence = coalesce(p_structured_evidence, '{}'::jsonb),
         requires_human_review = v_revisao,
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
-- G. Resolver os achados DE UM RDO
--
-- Chamada uma vez por RDO reavaliado, com a lista do que ainda vale. O
-- que estava aberto e nao esta na lista foi corrigido na origem.
--
-- REGRAS DE SERIE FICAM DE FORA. Elas nao pertencem a um RDO: "o numero
-- 11 esta duplicado" e' um fato do projeto. Se esta funcao as
-- alcancasse, reavaliar um RDO do grupo encerraria a duplicidade
-- inteira sem que ela tivesse sido corrigida.
--
-- A lista chega como `RULE_CODE|evidence_key` porque varios achados do
-- mesmo RDO compartilham a evidence_key.
--
-- Escopo por RDO e' essencial: resolver por execucao encerraria achados
-- de RDOs que aquela execucao sequer olhou.
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
     and not (rule_code = any (public.diario_de_obra_regras_de_serie()))
     and not (
       (rule_code || '|' || evidence_key)
         = any (coalesce(p_achados_ativos, array[]::text[]))
     );

  get diagnostics v_resolvidos = row_count;

  return v_resolvidos;
end;
$$;


-- ============================================================
-- H. Resolver os achados DE SERIE
--
-- Escopo: o PROJETO. Quem chama recalculou o conjunto completo esperado
-- a partir da serie inteira e passa esse conjunto; o que ficou de fora
-- deixou de existir — o numero foi corrigido, a lacuna foi preenchida.
--
-- SO PODE SER CHAMADA COM A SERIE COMPLETA. Com leitura truncada, o
-- conjunto esperado estaria errado e esta funcao encerraria achados
-- validos. O worker nao a chama quando a cobertura nao e' garantida.
-- ============================================================

create or replace function public.resolve_diario_de_obra_series_findings(
  p_project_id uuid,
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
     and status in ('OPEN', 'ACKNOWLEDGED')
     and rule_code = any (public.diario_de_obra_regras_de_serie())
     and not (
       (rule_code || '|' || evidence_key)
         = any (coalesce(p_achados_ativos, array[]::text[]))
     );

  get diagnostics v_resolvidos = row_count;

  return v_resolvidos;
end;
$$;


-- ============================================================
-- I. Grants
--
-- Nenhuma funcao de escrita e' alcancavel por sessao de usuario. Dar
-- isto a `authenticated` permitiria a um membro do projeto fabricar ou
-- apagar achado — e um achado fabricado destroi a utilidade de todos os
-- outros.
-- ============================================================

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.register_diario_de_obra_finding(uuid, uuid, uuid, text, text, text, text, text, jsonb, boolean, text)',
    'public.resolve_diario_de_obra_findings(uuid, uuid, text[])',
    'public.resolve_diario_de_obra_series_findings(uuid, text[])'
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
-- J. Leitores estruturados do RDO — em SQL
--
-- Existem para que a VIEW do painel devolva NUMERO em vez de documento.
-- A versao anterior exportava `clima` e `maoDeObra` crus e reduzia a
-- numero no servidor de aplicacao; isso funcionava, mas mandava para
-- fora do banco muito mais do que a tela precisa — e `maoDeObra` pode
-- trazer funcao e nome de quem esteve na obra.
--
-- Espelham `report-readers.ts`. A busca por "impratic" e' literal e
-- funciona com ou sem acento porque o acento de "Impraticavel" cai
-- depois do trecho procurado.
-- ============================================================

create or replace function public.diario_de_obra_numero_json(p_valor jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_texto text;
begin
  if p_valor is null then
    return null;
  end if;

  if jsonb_typeof(p_valor) = 'number' then
    return (p_valor #>> '{}')::numeric;
  end if;

  if jsonb_typeof(p_valor) = 'string' then
    -- A API usa virgula decimal em alguns campos numericos.
    v_texto := btrim(replace(p_valor #>> '{}', ',', '.'));

    if v_texto ~ '^-?[0-9]+(\.[0-9]+)?$' then
      return v_texto::numeric;
    end if;
  end if;

  return null;
end;
$$;

create or replace function public.diario_de_obra_turno_impraticavel(p_turno jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_turno is null then
    return false;
  end if;

  if jsonb_typeof(p_turno) = 'string' then
    return (p_turno #>> '{}') ilike '%impratic%';
  end if;

  if jsonb_typeof(p_turno) <> 'object' then
    return false;
  end if;

  -- `praticavel: false` e `impraticavel: true` sao a mesma afirmacao
  -- escrita nos dois sentidos; o modelo de relatorio decide qual usa.
  if p_turno @> '{"praticavel": false}'::jsonb then
    return true;
  end if;

  if p_turno @> '{"impraticavel": true}'::jsonb then
    return true;
  end if;

  return coalesce(p_turno ->> 'condicao', '') ilike '%impratic%'
      or coalesce(p_turno ->> 'condicoes', '') ilike '%impratic%'
      or coalesce(p_turno ->> 'status', '') ilike '%impratic%'
      or coalesce(p_turno ->> 'situacao', '') ilike '%impratic%'
      or coalesce(p_turno ->> 'descricao', '') ilike '%impratic%';
end;
$$;

/*
 * O sinalizador de DIA sem marca por turno conta como UM turno, nao
 * tres: sabemos que o dia teve impraticabilidade, nao quantos turnos
 * dela. Contar tres elevaria a severidade de MEDIO para ALTO com base
 * em suposicao.
 */
create or replace function public.diario_de_obra_turnos_impraticaveis(p_clima jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_turno text;
  v_total integer := 0;
begin
  if p_clima is null or jsonb_typeof(p_clima) <> 'object' then
    return 0;
  end if;

  foreach v_turno in array array['manha', 'tarde', 'noite']
  loop
    if public.diario_de_obra_turno_impraticavel(p_clima -> v_turno) then
      v_total := v_total + 1;
    end if;
  end loop;

  if v_total = 0 and p_clima @> '{"praticavel": false}'::jsonb then
    return 1;
  end if;

  return v_total;
end;
$$;

/*
 * Efetivo total do dia. NULL quando a forma nao e' legivel — e sem
 * leitura o RDO fica de fora da mediana, em vez de entrar como zero.
 */
create or replace function public.diario_de_obra_efetivo_total(p_labor jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_campo text;
  v_n numeric;
  v_total numeric := 0;
  v_leu boolean := false;
  v_itens jsonb;
begin
  if p_labor is null then
    return null;
  end if;

  if jsonb_typeof(p_labor) = 'array' then
    for v_item in select value from jsonb_array_elements(p_labor)
    loop
      if jsonb_typeof(v_item) <> 'object' then
        continue;
      end if;

      foreach v_campo in array array['quantidade', 'efetivo', 'total', 'qtd']
      loop
        v_n := public.diario_de_obra_numero_json(v_item -> v_campo);

        if v_n is not null then
          v_total := v_total + v_n;
          v_leu := true;
          exit;
        end if;
      end loop;
    end loop;

    -- Colecao vazia e' leitura valida: nenhum efetivo lancado.
    if v_leu or jsonb_array_length(p_labor) = 0 then
      return v_total;
    end if;

    return null;
  end if;

  if jsonb_typeof(p_labor) <> 'object' then
    return null;
  end if;

  foreach v_campo in array array['total', 'efetivo', 'totalEfetivo', 'quantidade']
  loop
    v_n := public.diario_de_obra_numero_json(p_labor -> v_campo);

    if v_n is not null then
      return v_n;
    end if;
  end loop;

  v_itens := coalesce(p_labor -> 'itens', p_labor -> 'funcionarios', p_labor -> 'equipes');

  if v_itens is not null and jsonb_typeof(v_itens) = 'array' then
    return public.diario_de_obra_efetivo_total(v_itens);
  end if;

  return null;
end;
$$;


-- ============================================================
-- K. Superficie de leitura do painel
--
-- SO AGREGADO SAI DAQUI. Ocorrencias e atividades viram CONTAGEM;
-- clima vira NUMERO DE TURNOS; mao de obra vira TOTAL. Nenhuma coluna
-- desta view e' documento, texto livre, nome, endereco, URL ou midia —
-- e nao ha mais nenhum jsonb cru atravessando a fronteira.
--
-- security_invoker: a view roda com os privilegios de quem consulta,
-- entao a RLS de diario_de_obra_reports (membros do projeto) continua
-- valendo. Sem isso a view furaria a RLS.
-- ============================================================

drop view if exists public.diario_de_obra_report_metrics;

create view public.diario_de_obra_report_metrics
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
    public.diario_de_obra_turnos_impraticaveis(r.weather) as impracticable_shifts,
    public.diario_de_obra_efetivo_total(r.labor) as labor_total
  from public.diario_de_obra_reports r;

grant select on public.diario_de_obra_report_metrics to authenticated;
