-- ============================================================
-- Diario de Obra — KPI de disponibilidade por CLIMA e CATASTROFES
--
-- Superficie de leitura nova, ao lado de `diario_de_obra_report_metrics`
-- (migration 20260907180000, NAO alterada aqui). O calculo do percentual
-- de disponibilidade e' feito em TypeScript puro
-- (`lib/integrations/diario-de-obra/climate-kpi.ts`), sobre os RDOs
-- inteiros do projeto — inclusive os 146 da carga baseline. Este arquivo
-- so entrega, POR RDO, os poucos fatos estruturados de que aquele calculo
-- precisa: quantidade de turnos impraticaveis, e se o RDO carrega uma das
-- 5 categorias de ocorrencia relevantes (Dia Parado, Dia Chuvoso e as
-- tres categorias de catastrofe).
--
-- ZERO TEXTO LIVRE ATRAVESSANDO A FRONTEIRA
--
-- A categoria de uma ocorrencia vem do campo ESTRUTURADO que a obra
-- escolheu num dropdown fechado (`tipo`/`tipoDeOcorrencia`/`categoria`/
-- `classificacao`, e dentro dele o ROTULO DA PROPRIA CATEGORIA — nunca a
-- descricao livre que o apontador escreveu). A logica abaixo e' o mesmo
-- percurso estrutural de `occurrence-taxonomy.ts:resolverCategoria`,
-- restrito as 5 categorias que este KPI usa. Nenhuma funcao aqui olha
-- para nome de pessoa, endereco, foto, anexo ou URL — essas colunas nem
-- sao lidas.
--
-- ZERO IA, ZERO LEXICO. Comparacao de string normalizada contra um
-- conjunto FECHADO de rotulos oficiais do formulario — nao heuristica
-- sobre texto livre.
--
-- security_invoker NA VIEW: a RLS de `diario_de_obra_reports` (membros
-- do projeto) continua valendo para quem consulta a view.
-- ============================================================


-- ------------------------------------------------------------
-- A. unaccent — necessaria para normalizar rotulo de categoria do mesmo
--    jeito que `occurrence-taxonomy.ts:normalizarRotuloDeCategoria` faz
--    em TypeScript (NFD, sem diacritico, minusculo). Extensao padrao do
--    Postgres, sem acesso a dado nenhum por si so.
-- ------------------------------------------------------------

create extension if not exists unaccent;


-- ------------------------------------------------------------
-- B. Normalizacao de rotulo
--
-- Espelha `normalizarRotuloDeCategoria`: NFD sem diacritico, minusculo,
-- pontuacao vira espaco, espacos colapsam.
-- ------------------------------------------------------------

create or replace function public.diario_de_obra_normalizar_rotulo(p_texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(regexp_replace(lower(public.unaccent(coalesce(p_texto, ''))), '[^a-z0-9]+', ' ', 'g')),
    ''
  );
$$;


-- ------------------------------------------------------------
-- C. Rotulo normalizado de UMA ocorrencia
--
-- Mesma cascata de campos que `resolverCategoria`: tenta
-- tipo/tipoDeOcorrencia/categoria/classificacao NESSA ORDEM; o primeiro
-- campo PRESENTE decide — string vira rotulo direto, objeto usa
-- descricao/nome/label/titulo/value; campo ausente passa para o
-- proximo. A descricao LIVRE da ocorrencia (`ocorrencia.descricao`,
-- fora do objeto de tipo) nunca e' lida por esta funcao.
-- ------------------------------------------------------------

create or replace function public.diario_de_obra_ocorrencia_rotulo(p_ocorrencia jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_campo text;
  v_interno text;
  v_bruto jsonb;
  v_valor jsonb;
begin
  if p_ocorrencia is null or jsonb_typeof(p_ocorrencia) <> 'object' then
    return null;
  end if;

  foreach v_campo in array array['tipo', 'tipoDeOcorrencia', 'categoria', 'classificacao']
  loop
    v_bruto := p_ocorrencia -> v_campo;

    if v_bruto is null or jsonb_typeof(v_bruto) = 'null' then
      continue;
    end if;

    if jsonb_typeof(v_bruto) = 'string' then
      return public.diario_de_obra_normalizar_rotulo(v_bruto #>> '{}');
    end if;

    if jsonb_typeof(v_bruto) = 'object' then
      foreach v_interno in array array['descricao', 'nome', 'label', 'titulo', 'value']
      loop
        v_valor := v_bruto -> v_interno;

        if v_valor is not null and jsonb_typeof(v_valor) = 'string' then
          return public.diario_de_obra_normalizar_rotulo(v_valor #>> '{}');
        end if;
      end loop;

      -- Objeto de tipo presente, rotulo irreconhecivel: para aqui, como
      -- o resolvedor em TypeScript — nao tenta o proximo campo.
      return null;
    end if;
  end loop;

  return null;
end;
$$;


-- ------------------------------------------------------------
-- D. Presenca de UMA categoria (por rotulo normalizado) nas ocorrencias
--    de um RDO.
-- ------------------------------------------------------------

create or replace function public.diario_de_obra_tem_categoria(p_occurrences jsonb, p_alvo text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  if p_occurrences is null or jsonb_typeof(p_occurrences) <> 'array' then
    return false;
  end if;

  for v_item in select value from jsonb_array_elements(p_occurrences)
  loop
    if public.diario_de_obra_ocorrencia_rotulo(v_item) = p_alvo then
      return true;
    end if;
  end loop;

  return false;
end;
$$;


-- ------------------------------------------------------------
-- E. Presenca de QUALQUER UMA das 3 categorias de catastrofe.
--
--    "Dano em estrutura existente - não mapeada", "Dano em estrutura
--    nova" e "Taludes danificado devido fortes chuvas" — as mesmas 3
--    linhas ALTO de `occurrence-taxonomy.ts` cujo rotulo cita dano
--    fisico ou estrutural. As demais categorias ALTO (aditivos,
--    cronograma, fiscalizacao...) nao sao catastrofe fisica e ficam de
--    fora de proposito.
-- ------------------------------------------------------------

create or replace function public.diario_de_obra_tem_catastrofe(p_occurrences jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_rotulo text;
begin
  if p_occurrences is null or jsonb_typeof(p_occurrences) <> 'array' then
    return false;
  end if;

  for v_item in select value from jsonb_array_elements(p_occurrences)
  loop
    v_rotulo := public.diario_de_obra_ocorrencia_rotulo(v_item);

    if v_rotulo = any (array[
      'dano em estrutura existente nao mapeada',
      'dano em estrutura nova',
      'taludes danificado devido fortes chuvas'
    ]) then
      return true;
    end if;
  end loop;

  return false;
end;
$$;


-- ------------------------------------------------------------
-- F. Superficie de leitura do KPI de clima
--
-- SO NUMERO, BOOLEANO E DATA saem daqui. `weather` e `occurrences`
-- nunca atravessam a fronteira — so o resultado ja resolvido delas.
-- `activity_count` e `labor_total` reaproveitam exatamente a mesma
-- forma de `diario_de_obra_report_metrics`.
--
-- SEM FILTRO POR baseline_imported: o KPI e' agregado historico sobre
-- TODOS os RDOs, diferente das regras de achado (que ignoram baseline).
-- Nenhum achado e' criado por esta view — ela e' so SELECT.
-- ------------------------------------------------------------

create or replace view public.diario_de_obra_climate_metrics
with (security_invoker = true)
as
  select
    r.id as report_id,
    r.project_id,
    r.reference_date,
    public.diario_de_obra_turnos_impraticaveis(r.weather) as impracticable_shifts,
    (r.weather is not null and r.weather <> '{}'::jsonb) as has_weather_data,
    public.diario_de_obra_tem_categoria(r.occurrences, 'dia chuvoso') as has_dia_chuvoso,
    public.diario_de_obra_tem_categoria(r.occurrences, 'dia parado') as has_dia_parado,
    public.diario_de_obra_tem_categoria(
      r.occurrences, 'taludes danificado devido fortes chuvas'
    ) as has_talude_danificado_chuva,
    public.diario_de_obra_tem_catastrofe(r.occurrences) as has_catastrofe,
    case
      when jsonb_typeof(r.activities) = 'array' then jsonb_array_length(r.activities)
      else 0
    end as activity_count,
    public.diario_de_obra_efetivo_total(r.labor) as labor_total
  from public.diario_de_obra_reports r;

grant select on public.diario_de_obra_climate_metrics to authenticated;
