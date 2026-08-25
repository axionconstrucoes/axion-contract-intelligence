-- ============================================================
-- supabase/seed_auth_dev.sql
-- DEV LOCAL ONLY
--
-- Cria a identidade mínima necessária para que o trigger
-- public.handle_new_user() gere public.profiles antes do
-- seed.sql principal.
-- ============================================================

insert into auth.users (
    id,
    email,
    raw_user_meta_data
)
values (
    '3d391d45-4824-4826-b4bd-725e766decc3',
    'auth-login-test@axion-test.local',
    '{"name":"auth-login-test@axion-test.local"}'::jsonb
)
on conflict (id) do update
set
    email = excluded.email,
    raw_user_meta_data = excluded.raw_user_meta_data;
