# Fase B — Supabase de homologação e Preview Vercel isolados (checklist)

> **Estado:** planejamento. Nada foi criado, alterado ou configurado em Supabase, Vercel, Google ou GitHub.
> Cada item marcado **[AUTORIZAÇÃO]** muda um sistema externo e só deve ser feito com aprovação explícita.
> Este documento lista **nomes** de variáveis, nunca valores.

## 0. Achado que vale independentemente da Fase B

Hoje as variáveis `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY` do
projeto Vercel `axion-contract-intelligence-5d3g` estão em **Production e Preview** (mesmo valor). Ou seja:
**qualquer deployment de Preview (todo PR) usa o banco de PRODUÇÃO com a chave de serviço.** Enquanto isso for
verdade, nenhum teste em Preview é isolado. Corrigir esse alvo (seção 3, passo V1) é pré-requisito de tudo.

Também: `supabase/.temp/project-ref` do checkout principal aponta para o projeto remoto de produção. Nunca rodar
`supabase db push`/`link`/`--linked` sem `--db-url` explícito do banco de homologação.

## 1. Recursos necessários

| Recurso | Para quê | Observações |
|---|---|---|
| **Novo projeto Supabase** (homologação) | Banco, Auth e Storage isolados | Anotar o *project ref* e a região; plano/custo a aprovar. Pode haver limite de projetos na organização. |
| Chaves do projeto novo: URL, *publishable key*, *secret key* | Variáveis `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Só no cofre da Vercel (escopo Preview/homologação). Nunca no Git nem no chat. |
| String de conexão direta do banco novo | Aplicar as 117 migrations (`--db-url`) | Usada uma vez, localmente; não fica salva. |
| **Ambiente Vercel de homologação** | Receber as variáveis acima sem tocar Production | Opção A: variáveis de *Preview* restritas à branch de teste (`gitBranch`). Opção B: *Custom Environment* (se o plano permitir). |
| Cliente OAuth Google (login) | Login no ACC de homologação | Incluir `https://<ref-homolog>.supabase.co/auth/v1/callback` nos URIs autorizados; em Supabase Auth: `site_url` e `additional_redirect_urls` = URL do Preview. |
| Caixa `crm@axion.com.br` | Único destino de e-mails de teste | Reaproveita credenciais Gmail já existentes só quando autorizado (ver riscos). |
| Usuários/dados fictícios | Projeto WEG de teste, membros, matriz, allowlist | Criados no banco de homologação (Auth Admin API + SQL), nunca copiados da produção. |

## 2. Configuração alvo (por nome)

| Variável | Production (como está) | Homologação / Preview isolado |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `..._PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` | produção | **somente do projeto de homologação** |
| `ACC_OUTBOUND_MODE` | (valor a conferir) | `pilot` **explícito** (nunca `production`) |
| `ACC_PILOT_RECIPIENT` | `crm@axion.com.br` | `crm@axion.com.br` |
| `ACC_PILOT_ADDITIONAL_RECIPIENTS` | inexistente | **não definir** (o guard atual já a ignora; ver `test-pilot-risk-alert-actions` 55) |
| `AXION_EMAIL_PROVIDER` | `gmail` | **ausente** (= provider fake) na primeira rodada; `gmail` apenas na etapa B3, com autorização |
| `GOOGLE_GMAIL_*` (envio) | produção | ausentes até B3 |
| `GOOGLE_GMAIL_INBOUND_MAILBOX` | (valor a conferir) | igual à caixa que recebe os alertas de teste; ver risco R3 |
| `AXION_APP_BASE_URL` | URL de produção | URL do Preview de homologação (obrigatória: sem ela os links falham em build de produção) |
| `CRON_SECRET`, `ACC_RISK_ALERTS_CRON_SECRET` | produção | segredos **novos**, só da homologação |
| `ACC_WEEKLY_REPORTS_ENABLED` | existe | `true` só no ambiente de homologação |
| `ANTHROPIC_*`, `AXION_AI_PROVIDER` | produção | ausentes (provider fake); `ANTHROPIC_MODEL` hoje também está em Preview, remover |
| `CONSTRUMANAGER_*` | produção e Preview | **remover de Preview** (integração externa) |
| `NEXT_PUBLIC_ACC_TEST_MODE` | produção | `true` (faixa "SISTEMA EM TESTE") |
| `ELEVENLABS_*` (futuro, Helpdesk) | inexistente | só variável de ambiente protegida; fora desta fase |

## 3. Passos (ordem obrigatória)

**Vercel — antes de qualquer teste**
- V1 **[AUTORIZAÇÃO]** Remover o alvo *Preview* das 3 variáveis Supabase de produção (ou recriá-las apenas para Production). A partir daí, um Preview sem as variáveis de homologação não consegue ler nem escrever em nenhum banco.
- V2 **[AUTORIZAÇÃO]** Remover `CONSTRUMANAGER_*` e `ANTHROPIC_MODEL` do alvo Preview.
- V3 **[AUTORIZAÇÃO]** Criar as variáveis da seção 2 no ambiente de homologação.

**Supabase (projeto novo)**
- S1 **[AUTORIZAÇÃO]** Criar o projeto e registrar o *ref* (diferente do de produção).
- S2 Aplicar `scripts/sql/bootstrap-default-privileges.sql` **antes** das migrations: projetos novos têm privilégios padrão restritivos e a migration `20260920170000_harden_weekly_report_database_permissions` falha sem isso (ver `docs/migration-privilegios-inicializacao-limpa.md`).
- S3 Aplicar as 117 migrations em ordem com `--db-url` do banco de homologação; conferir 117/117 e **0 tabelas de `public` sem RLS**.
- S4 Configurar Auth (Google, `site_url`, redirects) e confirmar os buckets de Storage criados pelas migrations.
- S5 Semear dados fictícios: projeto WEG de teste, 4 usuários (responsável, gestor, diretoria, fora da allowlist), matriz com prazos reduzidos **só aqui**, `pilot_delivery_override_email = crm@axion.com.br`, allowlist e confirmação do piloto.

## 4. Testes de isolamento (todos devem passar antes de qualquer envio real)

| # | Teste | Como verificar | Resultado esperado |
|---|---|---|---|
| T1 | Preview não enxerga o banco de produção | Listar as variáveis por alvo (só nomes/metadados) | Nenhuma variável Supabase de produção no alvo Preview/homologação |
| T2 | Host do banco do Preview | Rota de diagnóstico que devolve apenas o *ref* (ou hash) do host Supabase em uso | *ref* = homologação, ≠ produção |
| T3 | Canário de escrita | Gravar uma linha marcada em homologação; conferir leitura somente-contagem na homologação | Existe só na homologação (nada a consultar na produção) |
| T4 | Produção intacta | Comparar contagens/metadados somente-leitura de tabelas-chave antes e depois da bateria | Sem variação causada pelos testes |
| T5 | Modo de saída | Abrir um evento como administrador no Preview | Aviso "Modo piloto ativo" visível; envio manual redirecionado |
| T6 | Provider fake | `AXION_EMAIL_PROVIDER` ausente: executar o ciclo (`?dryRun=1` e real) | `provider = FAKE`, nenhum e-mail externo |
| T7 | Destinatário único | Primeiro envio real (etapa B3), 1 mensagem | Chega só em `crm@axion.com.br` com `[TESTE CONTROLADO]`; cabeçalho confirma |
| T8 | Allowlist | Alerta para usuário fora da allowlist | `SUPPRESSED`, nada enviado |
| T9 | Crons de produção | Conferir que os workflows do GitHub usam só segredos de produção e não apontam para o Preview | Nenhum cron toca a homologação; ciclos de homologação são disparados manualmente com `CRON_SECRET` próprio |
| T10 | Respostas | Responder do e-mail de um usuário cadastrado (não do `crm@`) | Aceita uma vez; resposta do `crm@` é `IGNORED_SELF` (esperado) |
| T11 | Idempotência | Executar o ciclo duas vezes e dois ciclos simultâneos | Nenhum envio duplicado (já provado em `test:alert-sim`; repetir contra o banco de homologação) |
| T12 | Reversão | Remover as variáveis do ambiente de homologação | Preview deixa de funcionar; produção inalterada |

## 5. Etapas e portões

1. **B0 (local)**: `npm run test:alerts` e `test:sql` verdes (feito na Fase A.2).
2. **B1**: V1–V2 + S1–S5 + T1–T4 e T9. Sem envio de e-mail.
3. **B2**: Preview com provider fake: T5, T6, T8, T10, T11.
4. **B3**: um único envio real controlado para `crm@axion.com.br` (T7), somente após leitura direta de `ACC_OUTBOUND_MODE` e `ACC_PILOT_RECIPIENT` no painel.

## 6. Riscos

- **R1** Preview hoje usa o banco de produção (seção 0).
- **R2** O valor de `ACC_OUTBOUND_MODE` de produção ainda não foi lido diretamente (a API da Vercel não revela valores *sensitive/encrypted*).
- **R3** A caixa `crm@` é compartilhada por produção e homologação: respostas de teste ficam na mesma caixa lida pelo worker de produção. A correlação por token/Message-ID evita ação cruzada, mas convém um *plus-address* de homologação (`crm+hml…`) ou caixa separada.
- **R4** Documentação divergente: `docs/transicao-remota/modo-de-envio-producao.md` ainda cita `ACC_PILOT_ADDITIONAL_RECIPIENTS` como exceção; o guard atual a ignora (CRM exclusivo desde o PR #111). Tratar o código como fonte da verdade e corrigir o texto.
- **R5** Corrida real entre conexões não foi exercitada (somente CAS em PGlite e cliente em memória); repetir em T11 contra o Postgres de homologação.
