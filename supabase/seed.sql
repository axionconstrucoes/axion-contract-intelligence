-- ============================================================
-- supabase/seed.sql
--
-- Arquivo destinado a DESENVOLVIMENTO (ambiente DEV). Não contém dado
-- de cliente real.
--
-- Pré-condição obrigatória: já deve existir um usuário no Supabase Auth
-- (auth.users) com o e-mail auth-login-test@axion-test.local, e o
-- profile correspondente já deve ter sido criado automaticamente pelo
-- trigger public.handle_new_user(). Este seed NÃO cria usuário de
-- autenticação nem profile — só lê o profile já existente.
--
-- Aplicação ao banco DEV remoto é MANUAL, nunca automática. NÃO use
-- `supabase db reset --linked` para aplicar este arquivo — isso reseta
-- o banco inteiro. O comando previsto (não executado por este arquivo
-- em si, deve ser rodado explicitamente quando decidido):
--
--   npx supabase db query --linked -f supabase/seed.sql
--
-- ============================================================

do $$
declare
  dev_user_id uuid;
  dev_project_id constant uuid := '00000000-0000-4000-8000-000000000001';
  conflicting_id uuid;
begin
  -- Localiza o profile DEV pelo e-mail estável, exigindo exatamente uma linha.
  begin
    select id
      into strict dev_user_id
      from public.profiles
      where email = 'auth-login-test@axion-test.local';
  exception
    when no_data_found then
      raise exception 'Seed DEV abortado: nenhum profile encontrado com email auth-login-test@axion-test.local. O usuário Auth DEV é pré-condição — crie-o antes de rodar este seed.';
    when too_many_rows then
      raise exception 'Seed DEV abortado: mais de um profile encontrado com email auth-login-test@axion-test.local. O seed não pode escolher ambiguamente qual usar.';
  end;

  -- Protege contra conflito de identidade lógica: outro projeto já usando
  -- este code, mas com id diferente do UUID fixo deste seed. Não tenta
  -- trocar a PK de um projeto existente.
  select id
    into conflicting_id
    from public.projects
    where code = 'AXION-DEV-001'
      and id <> dev_project_id;

  if conflicting_id is not null then
    raise exception 'Seed DEV abortado: já existe public.projects com code = AXION-DEV-001 mas id % (diferente do UUID fixo esperado %). O seed não altera a PK de um projeto existente.', conflicting_id, dev_project_id;
  end if;

  insert into public.projects (
    id, code, name, client, status, location, contract_number, start_date, baseline_end_date
  )
  values (
    dev_project_id,
    'AXION-DEV-001',
    '[DEV] Projeto de Testes',
    'Cliente Fictício DEV',
    'ATIVO',
    'Ambiente de Desenvolvimento',
    null,
    '2026-01-01',
    '2026-12-31'
  )
  on conflict (id) do update set
    code = excluded.code,
    name = excluded.name,
    client = excluded.client,
    status = excluded.status,
    location = excluded.location,
    contract_number = excluded.contract_number,
    start_date = excluded.start_date,
    baseline_end_date = excluded.baseline_end_date;

  insert into public.project_memberships (project_id, user_id, permission)
  values (dev_project_id, dev_user_id, 'ADMIN')
  on conflict (project_id, user_id) do update set
    permission = excluded.permission;
end $$;
