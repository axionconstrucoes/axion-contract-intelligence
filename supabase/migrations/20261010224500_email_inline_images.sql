create table if not exists public.email_inline_images (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  email_id uuid not null references public.emails(id) on delete cascade,
  content_id text not null,
  gmail_attachment_id text,
  original_file_name text,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  sha256_hash text not null check (sha256_hash ~ '^[0-9a-f]{64}$'),
  storage_bucket text not null default 'project-documents',
  storage_path text not null,
  created_at timestamptz not null default now(),
  unique (email_id, content_id),
  unique (storage_bucket, storage_path)
);

create index if not exists email_inline_images_email_id_idx
  on public.email_inline_images(email_id);

alter table public.email_inline_images enable row level security;

drop policy if exists "email_inline_images_select_project_members_only"
  on public.email_inline_images;

create policy "email_inline_images_select_project_members_only"
  on public.email_inline_images for select
  using (public.is_project_member(project_id));
