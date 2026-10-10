alter table public.emails
  add column if not exists body_text text,
  add column if not exists body_html text,
  add column if not exists body_fetched_at timestamptz;

comment on column public.emails.body_text is
  'Corpo textual integral obtido do provedor; text/plain preferido, fallback derivado de HTML.';

comment on column public.emails.body_html is
  'Corpo HTML original obtido do provedor para visualizacao documental segura em iframe sandbox.';

comment on column public.emails.body_fetched_at is
  'Momento em que o corpo integral foi obtido do provedor.';
