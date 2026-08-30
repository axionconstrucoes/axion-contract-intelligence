-- ============================================================
-- 20260829170000_single_active_contract_base_per_project.sql
-- Bloco 3 (rodada "produção") — "Por projeto, permitir somente um
-- contrato-base ativo". Achado real desta rodada: o banco remoto do
-- projeto AXION-DEV-001 tinha 2 documentos CONTRATO_BASE distintos com
-- conteúdo IDÊNTICO (mesmo hash) — exatamente o problema que este
-- requisito pede para nunca mais acontecer silenciosamente.
--
-- Um TRIGGER (não uma checagem dentro de register_project_document_
-- upload) é a garantia canônica aqui: qualquer caminho de escrita
-- futuro (upload avançado, upload múltiplo, promoção de anexo de
-- e-mail a documento, uma migração de dados) passa pela MESMA regra,
-- sem duplicar a checagem em cada RPC — nunca duas fontes de verdade
-- divergentes sobre "quantos contratos-base ativos este projeto tem".
--
-- "restaurar" (deleted_at volta a null) também é coberto — passa pelo
-- mesmo UPDATE que dispara este trigger, então restaurar um
-- CONTRATO_BASE enquanto outro já está ativo é igualmente bloqueado
-- (nunca silenciosamente permite 2 ativos ao mesmo tempo).
-- ============================================================

create or replace function public.enforce_single_active_contract_base()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'CONTRATO_BASE' then
    return new;
  end if;

  -- Só bloqueia quando o resultado da escrita deixaria o documento
  -- ATIVO (deleted_at is null) — enviar um CONTRATO_BASE para a
  -- lixeira nunca passa por aqui (kind não muda no trash), e um
  -- CONTRATO_BASE já inserido diretamente como trashed (caso raro,
  -- ex.: migração de dados) não conflita com o ativo existente.
  if new.deleted_at is not null then
    return new;
  end if;

  if exists (
    select 1
    from public.documents d
    where d.project_id = new.project_id
      and d.kind = 'CONTRATO_BASE'
      and d.deleted_at is null
      and d.id <> new.id
  ) then
    raise exception
      'SINGLE_ACTIVE_CONTRACT_BASE: este projeto já tem um Contrato-base ativo. Adicione como nova versão do Contrato-base existente em vez de criar um novo documento.';
  end if;

  return new;
end;
$$;

alter function public.enforce_single_active_contract_base() owner to postgres;

-- ACL de menor privilégio: função de trigger, nunca chamada diretamente
-- (o mecanismo de trigger não depende de GRANT EXECUTE ao role que fez
-- o INSERT/UPDATE — dispara independentemente das permissões de função
-- do chamador). Nenhum caller real (app nem outra function SQL) foi
-- encontrado para esta function fora do próprio trigger — revogado de
-- public/anon/authenticated/service_role; só o owner (postgres) mantém
-- acesso, implícito por ownership, sem necessidade de GRANT explícito.
revoke all on function public.enforce_single_active_contract_base() from public;
revoke all on function public.enforce_single_active_contract_base() from anon;
revoke all on function public.enforce_single_active_contract_base() from authenticated;
revoke all on function public.enforce_single_active_contract_base() from service_role;

drop trigger if exists documents_enforce_single_active_contract_base on public.documents;
create trigger documents_enforce_single_active_contract_base
  before insert or update of kind, deleted_at, project_id on public.documents
  for each row
  execute function public.enforce_single_active_contract_base();

comment on function public.enforce_single_active_contract_base() is
  'Garante no máximo 1 documento CONTRATO_BASE ativo (deleted_at is null) por projeto — canônico via trigger, nunca duplicado em cada RPC de escrita.';
