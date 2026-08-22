# E-mails Oficiais do ACC — Identidade, Template e Governança

Este documento descreve o padrão institucional dos e-mails enviados pelo
ACC (AXION Acompanhamento de Contratos): remetente, template HTML, botão
"RESPONDER AO ACC" e as regras de governança de IA aplicadas ao envio.

## 1. Remetente

- **Nome de exibição (fixo):** `ACC AXION CONTROLE DE CONTRATOS` —
  constante `ACC_SENDER_DISPLAY_NAME` em
  `apps/web/lib/email/sender-identity.ts`.
- **Endereço de envio (variável, real):** continua vindo de
  `GOOGLE_GMAIL_SENDER_EMAIL` — hoje `reynaldo@axion.com.br`. O nome de
  exibição é aplicado ao header `From` de **qualquer** endereço
  configurado ali; trocar o nome de exibição nunca troca nem quebra o
  remetente atualmente funcional.
- **Endereço institucional-alvo:** `acc_ia@axion.com.br`
  (`ACC_INSTITUTIONAL_TARGET_EMAIL`) — **ainda não autorizado** no Google
  Workspace nesta fase. `isInstitutionalSenderConfigured()` permite
  verificar, sem nunca assumir, se ele já está ativo.

### Configuração necessária para migrar o remetente real para `acc_ia@axion.com.br`

Nenhuma credencial foi inventada ou pressuposta. Antes de trocar
`GOOGLE_GMAIL_SENDER_EMAIL`, é necessário, no Google Workspace:

1. Criar/habilitar a mailbox `acc_ia@axion.com.br` (usuário de serviço ou
   grupo com envio habilitado).
2. Autorizar um OAuth Client (Google Cloud Console) com o scope
   `https://www.googleapis.com/auth/gmail.send` para essa mailbox.
3. Gerar um refresh token dedicado a essa mailbox — reutilizar
   `scripts/gmail-outbound-oauth.mjs` (mesmo fluxo já usado para a
   mailbox atual), rodando o consent flow autenticado **como**
   `acc_ia@axion.com.br`.
4. Atualizar as variáveis de ambiente (nunca versionadas em `.env`):
   `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`,
   `GOOGLE_GMAIL_REFRESH_TOKEN`, `GOOGLE_GMAIL_SENDER_EMAIL=acc_ia@axion.com.br`.
5. Só depois disso trocar `GOOGLE_GMAIL_SENDER_EMAIL` — `loadGmailConfig()`
   já falha fechado (lança erro, nunca envia) se qualquer uma dessas
   variáveis estiver ausente ou incompleta.

Até essa migração, o sistema continua enviando pela mailbox atualmente
configurada, com o nome de exibição institucional já aplicado.

## 2. Assunto dinâmico

Padrão fixo, com obra e nível de risco sempre dinâmicos:

```
ACC - ALERTAS DO CONTRATO - OBRA <NOME_DA_OBRA> - RISCO <NÍVEL>
```

Construído por `buildContractAlertSubject(projectName, severity)` em
`apps/web/lib/email/templates/contract-alert-template.ts`.

Mapeamento de nível de risco (`alertRiskLevelLabels`, no mesmo arquivo):

| `AlertSeverity` (schema real, feminino) | Rótulo de risco (masculino, usado no assunto/badge) |
| --- | --- |
| `BAIXA` | BAIXO |
| `MEDIA` | MÉDIO |
| `ALTA` | ALTO |
| `CRITICA` | CRÍTICO |

Este mapa é **deliberadamente separado** de `severityLabels`
(`apps/web/lib/labels.ts`, usado para "Severidade"/badges de UI, sempre
no feminino) — os dois nunca são unificados, porque servem contextos
gramaticais diferentes ("RISCO ALTO" vs. "Severidade Alta").

## 3. Template HTML

`buildContractAlertEmail()` (mesmo arquivo) monta `{subject, html, text}`
— sempre os dois formatos, nunca só HTML (clientes de e-mail sem suporte
a HTML recebem o texto).

- Fundo branco, texto principal sempre `#000000`.
- Badge de risco: **sempre mostra COR + TEXTO** (nunca só uma cor), com
  `RISCO <NÍVEL>` escrito dentro do badge.
  - BAIXO: fundo verde (`#16a34a`)
  - MÉDIO: fundo amarelo/âmbar (`#f59e0b`)
  - ALTO: fundo laranja (`#f97316`)
  - CRÍTICO: fundo vermelho (`#dc2626`), texto branco, forte destaque
- Campos do alerta (obra, risco, título, resumo, evento relacionado, base
  contratual, evidências principais, impacto potencial, ação
  recomendada, responsável, prazo): cada linha só aparece quando o dado é
  real — **nunca um placeholder inventado** tipo "A definir" quando o
  caller não tem essa informação (`responsibleName`/`dueDate`/
  `recommendedAction` ficam `null` até haver uma fonte real, ex.: um
  campo de Action Request ou de um Expert).

## 4. Botão "RESPONDER AO ACC"

`buildRespondToAccUrl()` (`apps/web/lib/email/build-respond-to-acc-url.ts`)
monta um link absoluto para a página real do evento
(`/[projectId]/ledger/[eventId]`), com metadata em query string:
`respond=acc`, `riskLevel`, `alertId` (quando existir), `msgId`/`threadId`
(quando disponíveis) e uma âncora `#responder-ao-acc`.

Fluxo real, ponta a ponta:

1. Usuário clica no botão no e-mail.
2. Chega em `/[projectId]/ledger/[eventId]?respond=acc&riskLevel=...`,
   autenticado (login corporativo já existente).
3. A página mostra um aviso "Você chegou aqui a partir de um alerta..." e
   rola até a seção real "Anotações do Evento" (`EventNotesSection` —
   já existente, com RLS/auditoria própria, ver
   `docs/ai/experts.md`).
4. A resposta do usuário vira uma `event_notes` real, vinculada ao
   evento/projeto certo, auditada (`EVENT_NOTE_CREATED`).

O botão nativo "Responder" do Gmail continua funcionando normalmente —
`Reply-To`/thread não são alterados pelo botão RESPONDER AO ACC.

## 5. Envio: `sendContractAlertEmail`

`apps/web/lib/email/send-contract-alert-email.ts` é o único ponto que
efetivamente envia um "Alerta do Contrato". Cadeia de governança:

```
achado de IA (event.aiAssessment, já existente)
  → humano com permissão EDITOR/ADMIN abre o formulário no Ledger
  → humano confirma o destinatário e clica em "Enviar Alerta"
  → sendContractAlertEmail() valida autorização (RLS + EDITOR/ADMIN)
  → EmailProvider.send() (Gmail real ou Fake, conforme AXION_EMAIL_PROVIDER)
  → grava em public.emails + audit_log_entries (CONTRACT_ALERT_EMAIL_SENT)
```

**Nunca existe envio automático por um Expert.** Nenhum Expert (Diretor
Comercial IA, ou os futuros) tem acesso a `sendContractAlertEmail` — os
Experts só podem preparar `draftCommunication`
(`status: "DRAFT_PENDING_REVIEW"`, ver `docs/ai/experts.md`), que precisa
ser copiado/adaptado por um humano no formulário real antes de qualquer
envio. `requiresHumanReview` continua `true` em todo achado que alimenta
um alerta.

## 6. Suporte a HTML no `EmailProvider`

`SendEmailInput.html` (opcional) foi adicionado em
`apps/web/lib/email/email-provider.ts`. Quando ausente, o comportamento é
**idêntico** ao anterior (`text/plain` puro) — o fluxo de notificação de
Action Request (`send-action-request-notification.ts`) não foi alterado
e continua enviando só texto. Quando presente, `buildMimeMessage`
(`apps/web/lib/email/mime-message.ts`, extraída de
`gmail-email-provider.ts` para ser testável fora do bundler) monta
`multipart/alternative` com as duas partes.

## 7. Documentos multilíngues

Não faz parte do padrão de e-mail em si — documentado separadamente em
`docs/multilingual-documents.md`.
