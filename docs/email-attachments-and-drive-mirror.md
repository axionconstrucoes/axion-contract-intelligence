# Anexos de E-mail e Espelho no Google Drive

Este documento descreve a arquitetura de ingestão de anexos de e-mail
(Gmail → Supabase) e do espelhamento best-effort no Google Drive.

**Arquitetura**: Supabase é a fonte operacional/autoritativa. Google
Drive é apenas um espelho documental — nunca uma dependência para a
ingestão funcionar.

## 1. Pipeline em dois estágios (decisão deliberada)

**Estágio A — Ingestão automática e segura** (`ingest-email-attachments.ts`):
Gmail → download → SHA-256 → Supabase Storage → linha em
`email_attachments`. Sempre segura de rodar — nunca cria
`documents`/`document_versions`, nunca cria `contract_events`.
`processing_status` começa `PENDING` (ainda não promovido).

**Estágio B — Promoção explícita** (`link-email-attachment-to-document.ts`):
uma chamada deliberada (`linkEmailAttachmentToDocument`) que cria a
linha real em `documents`/`document_versions`, **reaproveitando o
mesmo objeto no Storage** (nunca reenvia o arquivo) e exige um `kind`
explícito fornecido pelo chamador — nunca classificado
automaticamente. Isso mantém o requisito de que anexos "podem" ser
processados/usados como evidência (capacidade), sem forçar criação
automática de artefatos downstream (documento ou evento).

Por que dois estágios: a ingestão precisa ser sempre "segura de rodar
em lote" (idempotente, nunca falha por causa de decisões de
classificação); a promoção é o ponto de decisão humana/deliberada
sobre "isto é um CONTRATO_BASE, ADITIVO, etc." — nunca inferido.

## 2. Schema (`email_attachments`)

Migration `supabase/migrations/20260823060000_email_attachment_ingestion_foundation.sql`.
Sem nova função RPC/SECURITY DEFINER — segue o mesmo precedente de
`scripts/gmail-inbound-sync.mjs`: escrita sempre via client
service-role (bypassa RLS por design do Supabase), nunca pelo cliente
autenticado do navegador. RLS na tabela é **somente SELECT** para
membros do projeto (`is_project_member`) — sem policy de
insert/update/delete para `authenticated`.

Campos preservados exatamente como pedido: `original_file_name`,
`mime_type`, `file_size_bytes`, `sha256_hash`, `gmail_message_id`
(message_id), `gmail_thread_id` (thread_id), `gmail_attachment_id`
(attachment_id), `received_at`, `ingested_at`, `project_id`,
`storage_bucket`/`storage_path`, `processing_status`,
`source_language` (nullable, quando aplicável).

## 3. Storage

Reaproveita o bucket **único e já existente** `project-documents` —
nenhum bucket novo, nenhuma policy de Storage nova. O caminho
`{projectId}/email-attachments/{emailId}/{gmailAttachmentId}-{filename}`
já começa com `projectId`, que é exatamente o que as policies
existentes de Storage exigem (`storage.foldername(name)[1] = projectId`).

## 4. Hash e deduplicação (seção 4 do requisito)

- **Mesmo filename, conteúdo diferente** (gmail_attachment_id
  diferente): duas linhas, dois objetos no Storage — nunca colidem
  nem se sobrescrevem (caminho inclui o attachment_id).
- **Mesmo hash, e-mails diferentes**: duas linhas/dois objetos físicos
  independentes nesta fase — **deliberadamente sem dedupe físico**.
  `sha256_hash` fica gravado para uma otimização futura (reaproveitar
  o objeto físico), mas isso não foi implementado agora — cada anexo
  mantém sua própria proveniência (linha, e-mail, storage_path).
- **Reingestão do mesmo anexo** (mesmo `email_id` +
  `gmail_attachment_id`): idempotente via `UNIQUE(email_id,
  gmail_attachment_id)` + checagem prévia — nunca baixa/reenvia de
  novo, devolve a linha existente (`ALREADY_INGESTED`).

## 5. Google Drive

### 5.1. Pastas existentes (referência — nunca hardcodadas em código)

As 6 pastas + raiz já existem no Drive da AXION. Os IDs ficam **apenas
em variáveis de ambiente**, nunca em lógica de código:

| Variável de ambiente | Pasta |
| --- | --- |
| `GOOGLE_DRIVE_FOLDER_ROOT` | Raiz do projeto |
| `GOOGLE_DRIVE_FOLDER_CONTRACTUAL_DOCUMENTS` | Documentos contratuais |
| `GOOGLE_DRIVE_FOLDER_EMAIL_ATTACHMENTS` | Anexos de e-mail (usada nesta feature) |
| `GOOGLE_DRIVE_FOLDER_EVIDENCE` | Evidências |
| `GOOGLE_DRIVE_FOLDER_EXPORTS` | Exportações |
| `GOOGLE_DRIVE_FOLDER_REPORTS` | Relatórios |
| `GOOGLE_DRIVE_FOLDER_AUDIT_DOSSIERS` | Dossiês de auditoria |

`apps/web/lib/drive/drive-config.ts` (`readDriveFolderConfig`) lê
todas; apenas `GOOGLE_DRIVE_FOLDER_EMAIL_ATTACHMENTS` é exigida por
esta feature (as demais ficam disponíveis para uso futuro de outras
áreas do sistema).

### 5.2. Credenciais OAuth do Drive (ainda não configuradas)

Requer client próprio, **separado** do client de inbound do Gmail:
`GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
`GOOGLE_DRIVE_REFRESH_TOKEN`. `isDriveConfigured()` checa as 4
variáveis (as 3 acima + a pasta de anexos); `loadDriveConfig()` é
fail-closed — lança um único erro claro listando as variáveis
faltantes, nunca segue parcialmente.

### 5.3. Escopo OAuth do Gmail (mapeamento confirmado)

O escopo `gmail.readonly`, já usado pelo inbound sync existente,
**já é suficiente** para baixar corpo completo e bytes de anexo
(`messages.get` com `format: "full"` +
`messages.attachments.get`) — **nenhum novo consentimento OAuth do
Gmail foi necessário**. Drive é uma integração totalmente separada e
ainda não existe nenhum client Drive configurado no projeto.

### 5.4. Fluxo obrigatório e falha nunca bloqueante

```
GMAIL → baixar anexo → hash → SUPABASE DB → SUPABASE STORAGE
      → persistência confirmada → tentar GOOGLE DRIVE (best-effort)
```

`syncEmailAttachmentToDrive()` **nunca lança exceção** — sempre
resolve para um resultado tipado (`SYNCED | ALREADY_SYNCED | SKIPPED
| FAILED`). Se o Drive não estiver configurado
(`isDriveConfigured() === false` e nenhum client de teste injetado),
marca `drive_sync_status = 'SKIPPED'` sem tentar nenhuma chamada de
rede. Se a chamada ao Drive falhar, marca `drive_sync_status =
'FAILED'` com `drive_sync_error`. **Em nenhum dos dois casos o
`processing_status`/dados do anexo no Supabase são alterados** — a
ingestão já persistida continua válida independente do resultado do
Drive.

Retry: `scripts/retry-email-attachment-drive-sync.mjs` reprocessa
anexos com `drive_sync_status in ('PENDING', 'FAILED')` — idempotente,
nunca reenvia um anexo já `SYNCED`.

## 6. Timeline e Experts (seções 8–9 do requisito)

- **Timeline**: nenhuma alteração de UI feita nesta fase (fora de
  escopo — "não fazer frontend-design"). O dado já está disponível
  (`email_attachments` vinculado a `email_id`) para uma UI futura
  listar/abrir anexos preservando origem.
- **Experts / Context Builder**: `ContextEmail.attachments`
  (`apps/web/lib/ai/context/types.ts`) é um campo **obrigatório**
  (nunca `undefined`, `[]` quando não há anexo) com metadados leves
  (`id`, `originalFileName`, `mimeType`, `processingStatus`,
  `documentVersionId | null`) — populado em lote (sem N+1) por
  `getEmailAttachmentsForEmails` dentro de `resolveEmails()`
  (`build-event-context.ts`). Isso garante que um Expert **sempre
  saiba que um anexo existe**, mesmo antes de ele ser promovido —
  nunca ignora uma planilha/PDF anexado só porque ainda não foi
  processado. O **conteúdo** completo do anexo continua fluindo
  exclusivamente pelo mecanismo já existente e inalterado
  `ContextEvidence.documentVersionId`, uma vez que o anexo tenha sido
  promovido e vinculado via `event_evidence` — nenhum código novo foi
  necessário ali.

## 7. Event Ledger (seção 10)

Nem a ingestão (Estágio A) nem a promoção (Estágio B) criam
`contract_events`. Um evento só existe se criado por um fluxo
separado e deliberado (ex.: confrontação de cláusula) — nunca "porque
existe anexo".

## 8. Auditoria (seção 11)

Apenas 4 ações, sempre com metadata compacta e `actor_type='SYSTEM'`
(exigindo `actor_user_id` e `actor_label` nulos — bug já corrigido
anteriormente para esse constraint, nunca repetido aqui):

- `EMAIL_ATTACHMENT_INGESTED`
- `EMAIL_ATTACHMENT_PROCESSED`
- `DRIVE_FILE_SYNCED`
- `DRIVE_FILE_SYNC_FAILED`

## 9. Scripts (uso sob demanda — sem scheduler)

```
node --env-file=apps/web/.env.local scripts/gmail-attachment-ingest.mjs --apply
node --env-file=apps/web/.env.local scripts/gmail-attachment-ingest.mjs <projectId> --apply --limit=20

node --env-file=apps/web/.env.local scripts/retry-email-attachment-drive-sync.mjs --apply
node --env-file=apps/web/.env.local scripts/retry-email-attachment-drive-sync.mjs <projectId> --apply

node --env-file=apps/web/.env.local scripts/test-email-attachments.mjs
```

Sem `--apply`, os scripts de ingestão/retry apenas mostram quantos
itens seriam processados (mesmo padrão de `gmail-inbound-sync.mjs`).
Nenhum scheduler/cron foi criado — execução sempre manual, por
enquanto.

## 10. Pendências conscientes (fora de escopo desta fase)

- Dedupe físico de Storage por hash entre e-mails diferentes.
- UI da Timeline para listar/abrir anexos.
- OAuth do Google Drive ainda não configurado em nenhum ambiente
  (variáveis `GOOGLE_DRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN` ausentes) —
  todo anexo ingerido até lá fica `drive_sync_status = 'SKIPPED'`.
