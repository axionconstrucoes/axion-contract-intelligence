-- ============================================================
-- 20260824090000_project_membership_roles_status_area.sql
-- Fechamento do módulo Usuários e Permissões (ACC).
--
-- Escopo:
-- - migra project_memberships.permission para os 4 papéis do ACC
--   (ADMINISTRADOR/GESTOR/COLABORADOR/LEITURA), preservando a
--   hierarquia numérica antiga (ADMIN=3, EDITOR=2, VIEWER=1) para
--   que has_project_permission() continue funcionando sem alteração
--   nas dezenas de policies/funções de outras features que já
--   chamam has_project_permission(project_id, 'ADMIN'/'EDITOR'/'VIEWER');
-- - adiciona status (ACTIVE/INACTIVE) e area por membership — ambos
--   específicos do projeto, não do profile;
-- - corrige a classificação de origin para logins @axion.com.br;
-- - adiciona index UNIQUE case-insensitive em profiles.email;
-- - restringe UPDATE de profiles a campos não administrativos e
--   somente ao próprio dono da linha;
-- - impede autoalteração de membership (papel/status/remoção);
-- - impede que um projeto fique sem nenhum Administrador ativo
--   (trigger, não apenas RLS/UI);
-- - RPCs security definer para adicionar/alterar/desativar/remover
--   membros com auditoria atômica em audit_log_entries.
-- ============================================================


-- ============================================================
-- 1. project_memberships: novas colunas (status, area, created_at)
-- ============================================================

alter table public.project_memberships
  add column status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'INACTIVE')),
  add column area text
    check (
      area is null
      or area in (
        'DIRETORIA', 'ADMINISTRATIVO', 'COMERCIAL', 'FINANCEIRO',
        'ENGENHARIA', 'ORÇAMENTO', 'JURÍDICO', 'PLANEJAMENTO'
      )
    ),
  add column created_at timestamptz not null default now();

create index project_memberships_project_status_idx
  on public.project_memberships (project_id, status);


-- ============================================================
-- 2. project_memberships.permission: migração de valores
--    ADMIN -> ADMINISTRADOR / EDITOR -> COLABORADOR / VIEWER -> LEITURA
--    GESTOR é um papel novo, não recebe nenhuma linha automaticamente.
-- ============================================================

-- Descoberta dinâmica do CHECK constraint de permission pelo catálogo
-- do Postgres (pg_constraint.conkey casado com o attnum real da
-- coluna), em vez de presumir o nome "project_memberships_permission_check".
-- O nome auto-gerado por um CHECK inline sem nome costuma seguir essa
-- convenção, mas isto não é garantido em todo ambiente (ex.: uma
-- baseline/squash histórica pode ter renomeado a constraint) — buscar
-- pela coluna real elimina essa suposição sem enfraquecer a
-- integridade (a constraint antiga é sempre removida antes dos dados
-- migrarem, e uma nova, com nome conhecido, é criada logo em seguida).
do $$
declare
  v_permission_attnum smallint;
  v_constraint_name text;
begin
  select attnum into v_permission_attnum
  from pg_attribute
  where attrelid = 'public.project_memberships'::regclass
    and attname = 'permission'
    and not attisdropped;

  select con.conname into v_constraint_name
  from pg_constraint con
  where con.conrelid = 'public.project_memberships'::regclass
    and con.contype = 'c'
    and v_permission_attnum = any (con.conkey)
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table public.project_memberships drop constraint %I', v_constraint_name);
  end if;
end;
$$;

update public.project_memberships
set permission = case permission
  when 'ADMIN' then 'ADMINISTRADOR'
  when 'EDITOR' then 'COLABORADOR'
  when 'VIEWER' then 'LEITURA'
  else permission
end
where permission in ('ADMIN', 'EDITOR', 'VIEWER');

alter table public.project_memberships
  add constraint project_memberships_permission_check
  check (permission in ('ADMINISTRADOR', 'GESTOR', 'COLABORADOR', 'LEITURA'));


-- ============================================================
-- 3. profiles: corrigir classificação de origin e email único
-- ============================================================

-- Correção não destrutiva de dados históricos: usuários que já
-- autenticaram com domínio corporativo e nasceram como TERCEIRO
-- (default antigo do trigger) passam a AXION_INTERNO. Nenhuma linha
-- é apagada; apenas o campo origin é corrigido.
update public.profiles
set origin = 'AXION_INTERNO'
where origin <> 'AXION_INTERNO'
  and lower(split_part(email, '@', 2)) = 'axion.com.br';

create unique index profiles_email_unique_idx
  on public.profiles (lower(email));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email, origin, title, avatar_initials)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.email),
    new.email,
    coalesce(
      (new.raw_user_meta_data ->> 'origin')::public.user_origin,
      case
        when lower(split_part(new.email, '@', 2)) = 'axion.com.br'
          then 'AXION_INTERNO'::public.user_origin
        else 'TERCEIRO'::public.user_origin
      end
    ),
    new.raw_user_meta_data ->> 'title',
    new.raw_user_meta_data ->> 'avatar_initials'
  );
  return new;
end;
$$;

-- ---------- RLS: profiles UPDATE (self, campos não administrativos) ----------
-- email e origin nunca são editáveis pelo próprio usuário — a policy
-- de linha libera o UPDATE na própria linha, mas o GRANT por coluna
-- é que efetivamente impede a alteração de email/origin (e de
-- qualquer campo futuro que não seja explicitamente concedido).

create policy "profiles_update_self_limited_fields"
  on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

revoke update on public.profiles from authenticated;
grant update (name, title, avatar_initials) on public.profiles to authenticated;


-- ============================================================
-- 4. is_project_member / has_project_permission: exigir status ACTIVE
--    e reconhecer os novos nomes de papel, mantendo compatibilidade
--    com todas as chamadas existentes que passam 'ADMIN'/'EDITOR'/'VIEWER'.
-- ============================================================

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and pm.status = 'ACTIVE'
  );
$$;

create or replace function public.has_project_permission(p_project_id uuid, p_min text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and pm.status = 'ACTIVE'
      and (
        case pm.permission
          when 'ADMINISTRADOR' then 3
          when 'GESTOR' then 2
          when 'COLABORADOR' then 2
          when 'LEITURA' then 1
          -- valores legados: nenhuma linha deveria mais existir com
          -- estes valores após a migração acima, mas mantemos o
          -- mapeamento por segurança/defesa em profundidade.
          when 'ADMIN' then 3
          when 'EDITOR' then 2
          when 'VIEWER' then 1
          else 0
        end
      ) >= (
        case p_min
          when 'ADMINISTRADOR' then 3
          when 'GESTOR' then 2
          when 'COLABORADOR' then 2
          when 'LEITURA' then 1
          when 'ADMIN' then 3
          when 'EDITOR' then 2
          when 'VIEWER' then 1
          else 0
        end
      )
  );
$$;

-- profiles: "theirs" continua sem filtro de status (um Administrador
-- ativo precisa continuar vendo o profile de um colega desativado
-- naquele projeto, para exibir nome/avatar na página Usuários);
-- "mine" agora exige status ACTIVE — um membro desativado perde a
-- visão de perfis de outros membros do mesmo projeto.
drop policy if exists "profiles_select_self_or_project_peer" on public.profiles;

create policy "profiles_select_self_or_project_peer"
  on public.profiles
  for select
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.project_memberships mine
      join public.project_memberships theirs
        on theirs.project_id = mine.project_id
      where mine.user_id = auth.uid()
        and mine.status = 'ACTIVE'
        and theirs.user_id = public.profiles.id
    )
  );


-- ============================================================
-- 5. project_memberships: policies de escrita separadas, com
--    bloqueio explícito de autoalteração (requisito 7).
-- ============================================================

drop policy if exists "project_memberships_write_admin_only" on public.project_memberships;

create policy "project_memberships_insert_admin_only"
  on public.project_memberships
  for insert
  with check (public.has_project_permission(project_id, 'ADMINISTRADOR'));

create policy "project_memberships_update_admin_not_self"
  on public.project_memberships
  for update
  using (
    public.has_project_permission(project_id, 'ADMINISTRADOR')
    and user_id <> auth.uid()
  )
  with check (
    public.has_project_permission(project_id, 'ADMINISTRADOR')
    and user_id <> auth.uid()
  );

create policy "project_memberships_delete_admin_not_self"
  on public.project_memberships
  for delete
  using (
    public.has_project_permission(project_id, 'ADMINISTRADOR')
    and user_id <> auth.uid()
  );


-- ============================================================
-- 6. Proteção do último Administrador ativo — implementada no
--    banco via trigger, independente de RLS, UI ou do caminho usado
--    (RPC ou acesso direto à tabela).
--
-- Concorrência: duas transações simultâneas rebaixando/removendo/
-- desativando DOIS Administradores DIFERENTES do MESMO projeto, sob
-- READ COMMITTED (padrão do Postgres/Supabase), cada uma enxergaria o
-- outro Administrador como ainda ativo no instante da contagem — um
-- clássico TOCTOU (check-then-act) que deixaria o projeto sem nenhum
-- Administrador se ambas confirmassem. Por isso, antes de contar
-- quantos Administradores ativos restam, o trigger toma um lock de
-- linha (SELECT ... FOR UPDATE) na linha correspondente em
-- public.projects. As duas transações concorrentes disputam esse
-- mesmo lock; a segunda só prossegue depois que a primeira confirma
-- (commit) ou desfaz (rollback) — e, sob READ COMMITTED, cada novo
-- comando SQL tira um snapshot novo ao ser liberado da espera do
-- lock, então a contagem da segunda transação já reflete o resultado
-- (committed) da primeira. Isso serializa, por projeto, qualquer
-- operação que possa reduzir a contagem de Administradores ativos —
-- sem impactar operações concorrentes em OUTROS projetos (o lock é
-- por linha de projects, não da tabela inteira) nem operações que não
-- envolvem um Administrador ativo saindo desse estado (o lock só é
-- tomado quando isso está em jogo).
-- ============================================================

create function public.prevent_last_administrator_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_remaining_admins int;
  v_was_active_admin boolean;
  v_still_active_admin boolean;
begin
  if tg_op = 'DELETE' then
    v_project_id := old.project_id;
    v_was_active_admin := (old.permission = 'ADMINISTRADOR' and old.status = 'ACTIVE');

    if v_was_active_admin then
      -- Serializa concorrência entre transações que afetam
      -- Administradores do MESMO projeto (ver comentário acima).
      perform 1 from public.projects where id = v_project_id for update;

      select count(*) into v_remaining_admins
      from public.project_memberships
      where project_id = v_project_id
        and permission = 'ADMINISTRADOR'
        and status = 'ACTIVE'
        and user_id <> old.user_id;

      if v_remaining_admins = 0 then
        raise exception
          'Operação bloqueada: o projeto ficaria sem nenhum Administrador ativo.';
      end if;
    end if;

    return old;
  end if;

  if tg_op = 'UPDATE' then
    v_project_id := new.project_id;
    v_was_active_admin := (old.permission = 'ADMINISTRADOR' and old.status = 'ACTIVE');
    v_still_active_admin := (new.permission = 'ADMINISTRADOR' and new.status = 'ACTIVE');

    if v_was_active_admin and not v_still_active_admin then
      -- Mesmo lock de serialização do ramo DELETE acima.
      perform 1 from public.projects where id = v_project_id for update;

      select count(*) into v_remaining_admins
      from public.project_memberships
      where project_id = v_project_id
        and permission = 'ADMINISTRADOR'
        and status = 'ACTIVE'
        and user_id <> old.user_id;

      if v_remaining_admins = 0 then
        raise exception
          'Operação bloqueada: o projeto ficaria sem nenhum Administrador ativo.';
      end if;
    end if;

    return new;
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.prevent_last_administrator_removal() from public;

create trigger project_memberships_prevent_last_admin_removal
  before update or delete on public.project_memberships
  for each row execute function public.prevent_last_administrator_removal();


-- ============================================================
-- 7. RPCs de gestão de membros — checagem de autorização + mutação
--    + auditoria atômica em uma única função security definer.
--    O trigger da seção 6 e as policies da seção 5 continuam valendo
--    como segunda camada de defesa, inclusive para este caminho.
-- ============================================================

-- ---------- find_profile_by_email ----------
-- Usado pela tela "Adicionar usuário" para checar se o e-mail já
-- possui profile (já fez o primeiro login).
--
-- Proteção contra enumeração de usuários:
-- 1. Exige Administrador do projeto informado (p_project_id) — nunca
--    "Administrador de algum projeto qualquer"; quem não é
--    Administrador de NENHUM projeto não consegue chamar esta função
--    de jeito nenhum.
-- 2. É uma busca por igualdade exata de um e-mail específico que o
--    chamador já precisa conhecer — não existe parâmetro de busca
--    parcial/prefixo/wildcard, então não dá para "listar" ou
--    "varrer" a base de usuários por aqui, só confirmar um e-mail já
--    conhecido de cada vez.
-- 3. Restringe a busca ao domínio corporativo — e-mail fora de
--    @axion.com.br nunca pode ter profile (login é só Google
--    Workspace @axion.com.br), então nem tenta consultar; reduz a
--    função a exatamente seu propósito, sem servir de oráculo de
--    e-mail genérico.
-- 4. Retorna apenas o mínimo necessário para o Administrador
--    confirmar a pessoa certa antes de adicioná-la (nome, iniciais) —
--    nunca ecoa de volta o e-mail nem qualquer outro campo do profile.

create function public.find_profile_by_email(p_project_id uuid, p_email text)
returns table (id uuid, name text, avatar_initials text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Apenas administradores do projeto podem consultar usuários.';
  end if;

  if lower(split_part(p_email, '@', 2)) <> 'axion.com.br' then
    return;
  end if;

  return query
    select p.id, p.name, p.avatar_initials
    from public.profiles p
    where lower(p.email) = lower(p_email);
end;
$$;

revoke all on function public.find_profile_by_email(uuid, text) from public;
grant execute on function public.find_profile_by_email(uuid, text) to authenticated;


-- ---------- add_project_member ----------

create function public.add_project_member(
  p_project_id uuid,
  p_user_id uuid,
  p_permission text,
  p_area text default null
)
returns public.project_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.project_memberships;
begin
  -- Redundante com a checagem de admin abaixo (quem chama já precisa
  -- ser Administrador do projeto-alvo, e portanto já teria uma
  -- membership própria ali, o que faria esta chamada colidir com a
  -- constraint de duplicidade) — mantido explícito mesmo assim, para
  -- não depender dessa dedução indireta caso a checagem de admin
  -- mude no futuro (mesmo padrão de bloqueio explícito das demais
  -- RPCs de gestão de membros).
  if p_user_id = auth.uid() then
    raise exception 'Não é permitido usar esta operação para a própria membership.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Apenas administradores do projeto podem adicionar membros.';
  end if;

  if p_permission not in ('ADMINISTRADOR', 'GESTOR', 'COLABORADOR', 'LEITURA') then
    raise exception 'Papel inválido: %', p_permission;
  end if;

  begin
    insert into public.project_memberships (project_id, user_id, permission, area, status)
    values (p_project_id, p_user_id, p_permission, p_area, 'ACTIVE')
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'Este usuário já é membro deste projeto.';
  end;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
  )
  values (
    p_project_id, 'USER', auth.uid(), 'MEMBER_ADDED', 'project_memberships', p_user_id::text,
    format(
      'Membro adicionado ao projeto com papel %s%s.',
      p_permission,
      case when p_area is not null then format(' (área: %s)', p_area) else '' end
    )
  );

  return v_row;
end;
$$;

revoke all on function public.add_project_member(uuid, uuid, text, text) from public;
grant execute on function public.add_project_member(uuid, uuid, text, text) to authenticated;


-- ---------- update_project_member_role ----------

create function public.update_project_member_role(
  p_project_id uuid,
  p_user_id uuid,
  p_new_permission text
)
returns public.project_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_permission text;
  v_row public.project_memberships;
begin
  if p_user_id = auth.uid() then
    raise exception 'Não é permitido alterar o próprio papel no projeto.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Apenas administradores do projeto podem alterar papéis.';
  end if;

  if p_new_permission not in ('ADMINISTRADOR', 'GESTOR', 'COLABORADOR', 'LEITURA') then
    raise exception 'Papel inválido: %', p_new_permission;
  end if;

  select permission into v_old_permission
  from public.project_memberships
  where project_id = p_project_id and user_id = p_user_id;

  if not found then
    raise exception 'Membership não encontrada.';
  end if;

  update public.project_memberships
  set permission = p_new_permission
  where project_id = p_project_id and user_id = p_user_id
  returning * into v_row;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
  )
  values (
    p_project_id, 'USER', auth.uid(), 'MEMBER_ROLE_CHANGED', 'project_memberships', p_user_id::text,
    format('Papel do membro alterado de %s para %s.', v_old_permission, p_new_permission)
  );

  return v_row;
end;
$$;

revoke all on function public.update_project_member_role(uuid, uuid, text) from public;
grant execute on function public.update_project_member_role(uuid, uuid, text) to authenticated;


-- ---------- set_project_member_status ----------

create function public.set_project_member_status(
  p_project_id uuid,
  p_user_id uuid,
  p_status text
)
returns public.project_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.project_memberships;
  v_action text;
  v_detail text;
begin
  if p_user_id = auth.uid() then
    raise exception 'Não é permitido ativar/desativar a própria membership no projeto.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Apenas administradores do projeto podem ativar/desativar membros.';
  end if;

  if p_status not in ('ACTIVE', 'INACTIVE') then
    raise exception 'Status inválido: %', p_status;
  end if;

  if p_status = 'INACTIVE' then
    v_action := 'MEMBER_DEACTIVATED';
    v_detail := 'Membro desativado neste projeto.';
  else
    v_action := 'MEMBER_REACTIVATED';
    v_detail := 'Membro reativado neste projeto.';
  end if;

  update public.project_memberships
  set status = p_status
  where project_id = p_project_id and user_id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'Membership não encontrada.';
  end if;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
  )
  values (p_project_id, 'USER', auth.uid(), v_action, 'project_memberships', p_user_id::text, v_detail);

  return v_row;
end;
$$;

revoke all on function public.set_project_member_status(uuid, uuid, text) from public;
grant execute on function public.set_project_member_status(uuid, uuid, text) to authenticated;


-- ---------- remove_project_member ----------

create function public.remove_project_member(
  p_project_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_permission text;
begin
  if p_user_id = auth.uid() then
    raise exception 'Não é permitido remover a própria membership do projeto.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Apenas administradores do projeto podem remover membros.';
  end if;

  select permission into v_old_permission
  from public.project_memberships
  where project_id = p_project_id and user_id = p_user_id;

  if not found then
    raise exception 'Membership não encontrada.';
  end if;

  delete from public.project_memberships
  where project_id = p_project_id and user_id = p_user_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
  )
  values (
    p_project_id, 'USER', auth.uid(), 'MEMBER_REMOVED', 'project_memberships', p_user_id::text,
    format('Membro removido do projeto (papel anterior: %s).', v_old_permission)
  );
end;
$$;

revoke all on function public.remove_project_member(uuid, uuid) from public;
grant execute on function public.remove_project_member(uuid, uuid) to authenticated;
