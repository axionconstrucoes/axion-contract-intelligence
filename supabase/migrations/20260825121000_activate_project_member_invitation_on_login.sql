-- ============================================================
-- 20260825121000_activate_project_member_invitation_on_login.sql
-- Ativação de pré-cadastro no primeiro login (seção "Pré-cadastro de
-- usuários", fluxo passos 3-8). CREATE OR REPLACE de handle_new_user
-- (identity_foundation, 20260817191336; já substituída uma vez por
-- 20260824090000) — nunca editando nenhuma migration histórica,
-- mesmo padrão já usado em 20260822060313_fix_system_actor_audit_label.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.project_member_invitations%rowtype;
  v_error_message text;
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

  -- Comparação EXATA (case-insensitive) do e-mail autenticado contra
  -- cada pré-cadastro pendente — "qualquer divergência bloqueia a
  -- ativação" (seção 8): nunca aproximado, nunca por nome. Um mesmo
  -- e-mail pode ter pré-cadastros pendentes em vários projetos —
  -- todos ativados aqui, no mesmo primeiro login.
  for v_invitation in
    select *
    from public.project_member_invitations
    where status = 'PENDING'
      and lower(email) = lower(new.email)
    order by created_at
    for update
  loop
    -- Cada pré-cadastro é isolado num bloco próprio (savepoint implícito
    -- do PL/pgSQL): um erro processando UM convite nunca deixa os
    -- demais convites do mesmo usuário (em outros projetos) num estado
    -- inconsistente, e nunca aborta o login em si (a inserção do
    -- profile, feita antes do laço, já está fora deste bloco).
    begin
      -- Defesa em profundidade: pre_register_project_member já impede
      -- pré-cadastro duplicado para quem já tem profile, mas nunca
      -- confiar só nisso — se por qualquer motivo já existir membership,
      -- este pré-cadastro específico é cancelado (nunca sobrescreve uma
      -- membership real), sem bloquear os demais nem o login em si.
      if not exists (
        select 1
        from public.project_memberships
        where project_id = v_invitation.project_id
          and user_id = new.id
      ) then
        insert into public.project_memberships (project_id, user_id, permission, area, status)
        values (v_invitation.project_id, new.id, v_invitation.permission, v_invitation.area, 'ACTIVE');

        -- Cargo pré-cadastrado só é aplicado se o profile recém-criado
        -- ainda não tiver título nenhum — nunca sobrescreve um valor que
        -- por algum motivo já exista.
        if v_invitation.job_title is not null then
          update public.profiles
          set title = v_invitation.job_title
          where id = new.id
            and title is null;
        end if;

        update public.project_member_invitations
        set status = 'ACTIVATED', activated_at = now(), profile_id = new.id
        where id = v_invitation.id;

        insert into public.audit_log_entries (
          project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
        )
        values (
          v_invitation.project_id, 'SYSTEM', null, 'MEMBER_INVITATION_ACTIVATED', 'project_memberships', new.id::text,
          format('Pré-cadastro ativado no primeiro login: papel %s.', v_invitation.permission)
        );
      else
        update public.project_member_invitations
        set status = 'CANCELLED', cancelled_at = now()
        where id = v_invitation.id;

        insert into public.audit_log_entries (
          project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
        )
        values (
          v_invitation.project_id, 'SYSTEM', null, 'MEMBER_INVITATION_CANCELLED', 'project_member_invitations', v_invitation.id::text,
          format(
            'Pré-cadastro cancelado no primeiro login de %s: já existe vínculo ativo deste usuário neste projeto.',
            lower(new.email)
          )
        );
      end if;
    exception
      when others then
        -- Fail-closed: qualquer erro inesperado neste convite específico
        -- cancela SÓ ele (nunca deixa PENDING num estado ambíguo, nunca
        -- concede acesso), preserva o login e os demais convites, e
        -- audita o motivo para revisão humana. get stacked diagnostics
        -- captura a mensagem do erro após o rollback implícito do bloco.
        get stacked diagnostics v_error_message = message_text;

        update public.project_member_invitations
        set status = 'CANCELLED', cancelled_at = now()
        where id = v_invitation.id
          and status = 'PENDING';

        insert into public.audit_log_entries (
          project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
        )
        values (
          v_invitation.project_id, 'SYSTEM', null, 'MEMBER_INVITATION_CANCELLED', 'project_member_invitations', v_invitation.id::text,
          format(
            'Pré-cadastro cancelado no primeiro login de %s por erro no processamento: %s',
            lower(new.email), v_error_message
          )
        );
    end;
  end loop;

  return new;
end;
$$;
