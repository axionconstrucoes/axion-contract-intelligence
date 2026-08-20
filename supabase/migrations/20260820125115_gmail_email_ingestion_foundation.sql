-- ============================================================
-- gmail_email_ingestion_foundation.sql
--
-- Identidade tecnica e deduplicacao de mensagens ingeridas.
--
-- public.emails continua sendo o registro principal da mensagem.
-- notification_email_deliveries permanece reservado ao fluxo
-- especifico de notificacoes da plataforma.
--
-- Nenhuma credencial OAuth e armazenada nesta tabela.
-- ============================================================

alter table public.emails
  add column provider text,
  add column provider_message_id text,
  add column provider_thread_id text,
  add column message_id_header text,
  add column mailbox_address text,
  add column direction text;

alter table public.emails
  add constraint emails_provider_check
    check (
      provider is null
      or provider in ('GMAIL')
    ),

  add constraint emails_direction_check
    check (
      direction is null
      or direction in ('INBOUND', 'OUTBOUND')
    ),

  add constraint emails_provider_identity_consistency_check
    check (
      (
        provider is null
        and provider_message_id is null
        and provider_thread_id is null
        and mailbox_address is null
        and direction is null
      )
      or
      (
        provider is not null
        and provider_message_id is not null
        and mailbox_address is not null
        and direction is not null
      )
    );

-- Uma mensagem Gmail nao pode ser ingerida duas vezes na mesma mailbox.
create unique index emails_gmail_mailbox_message_unique_idx
  on public.emails (
    project_id,
    provider,
    mailbox_address,
    provider_message_id
  )
  where provider = 'GMAIL'
    and provider_message_id is not null;

create index emails_provider_thread_idx
  on public.emails (
    project_id,
    provider,
    provider_thread_id
  )
  where provider_thread_id is not null;

create index emails_message_id_header_idx
  on public.emails (message_id_header)
  where message_id_header is not null;

create index emails_mailbox_sent_at_idx
  on public.emails (
    project_id,
    mailbox_address,
    sent_at desc
  )
  where mailbox_address is not null;

-- Os campos antigos permanecem intactos para compatibilidade
-- com getEmails()/getEmail() e com a interface existente.
--
-- Tokens, refresh tokens, client secrets e demais credenciais
-- nunca devem ser gravados em public.emails.
