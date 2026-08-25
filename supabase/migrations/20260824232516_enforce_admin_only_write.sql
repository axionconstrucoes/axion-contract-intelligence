-- ============================================================
-- ACC — somente ADMINISTRADOR possui permissão de edição
--
-- Regra corporativa:
--   ADMINISTRADOR = leitura + escrita/administração
--   GESTOR        = somente leitura
--   COLABORADOR   = somente leitura
--   LEITURA       = somente leitura
--
-- Mantém compatibilidade com policies históricas que ainda
-- solicitam ADMIN / EDITOR / VIEWER.
-- ============================================================

create or replace function public.has_project_permission(
  p_project_id uuid,
  p_min text
)
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

          -- Todos os demais perfis são somente leitura.
          when 'GESTOR' then 1
          when 'COLABORADOR' then 1
          when 'LEITURA' then 1

          -- Compatibilidade defensiva com dados antigos.
          when 'ADMIN' then 3
          when 'EDITOR' then 1
          when 'VIEWER' then 1
          else 0
        end
      ) >= (
        case p_min
          -- Escrita/administração.
          when 'ADMINISTRADOR' then 3
          when 'ADMIN' then 3

          -- Qualquer chamada histórica que exigia edição
          -- passa a ser satisfeita somente por ADMINISTRADOR.
          when 'GESTOR' then 2
          when 'COLABORADOR' then 2
          when 'EDITOR' then 2

          -- Leitura.
          when 'LEITURA' then 1
          when 'VIEWER' then 1

          else 999
        end
      )
  );
$$;