-- ============================================================
-- Diario de Obra — correcao do extrator de efetivo (mao de obra)
--
-- MIGRATION CORRETIVA. Nao edita nenhuma migration ja aplicada: so
-- substitui, via `create or replace function`, o CORPO de
-- `diario_de_obra_efetivo_total` (criada em 20260907180000). A
-- assinatura e' identica, entao `diario_de_obra_report_metrics` e
-- `diario_de_obra_climate_metrics` — as duas views que ja chamam esta
-- funcao — passam a ler certo sem serem tocadas: nenhuma delas e'
-- recriada aqui, `security_invoker` e RLS delas continuam exatamente
-- como estavam.
--
-- O BUG, MEDIDO NA OBRA REAL
--
-- `diario_de_obra_efetivo_total` so sabia ler `{ total | efetivo |
-- totalEfetivo | quantidade }` no topo, ou uma lista em `itens` /
-- `funcionarios` / `equipes`. A obra real usa uma quarta forma, nunca
-- prevista: `{ opcaoSelecionada: "padrao" | "personalizada", padrao:
-- [...], personalizada: [...] }` — a obra escolhe um dos dois modelos
-- de lancamento, e SO a lista escolhida tem item de verdade; a outra
-- fica presente e vazia. Sem essa forma, a funcao devolvia NULL para
-- os 146 RDOs, e o painel mostrava "—" onde a mediana e' ~32.
--
-- POR QUE LISTA VAZIA AQUI NAO E' ZERO
--
-- O ramo generico (a lista `itens`/`funcionarios`/`equipes` de cima)
-- trata colecao vazia como leitura valida de zero — decisao antiga e
-- deliberada, mantida como estava. Mas para `padrao`/`personalizada`
-- especificamente, uma lista vazia e' a opcao NAO ESCOLHIDA pela obra:
-- ela nunca foi preenchida, entao ler "0" ali inventaria um dado que
-- a obra nunca lancou. So a leitura MEDIDA (3 dos 146 RDOs, exatamente
-- o "3 de 146 sem mao de obra" observado) fica de fora da mediana como
-- ausencia real, nao como zero.
-- ============================================================

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
  v_opcao text;
  v_selecionado jsonb;
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

  -- Forma medida em producao: ve-la primeiro, antes dos ramos
  -- genericos abaixo, porque e' a forma que a obra real de fato usa.
  v_opcao := p_labor ->> 'opcaoSelecionada';

  if v_opcao in ('padrao', 'personalizada') then
    v_selecionado := p_labor -> v_opcao;

    if jsonb_typeof(v_selecionado) = 'array' then
      if jsonb_array_length(v_selecionado) = 0 then
        return null;
      end if;

      return public.diario_de_obra_efetivo_total(v_selecionado);
    end if;
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
