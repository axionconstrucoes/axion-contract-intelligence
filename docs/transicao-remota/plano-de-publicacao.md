# Plano de transição remota e de publicação

> **Estado em 27/10/2026: PUBLICADO.** A `main` está em `7dc8d8d` (PR #121 → `44571fe`; PR #122, correção do SSMA
> → `ee9679a`; PR #123, área "Ajuda e tutorial" → `7dc8d8d`). As 8 migrations foram aplicadas em produção
> (`aplicacao-migrations-producao.md`) e `acc.axion.com.br` está servido pelos deploys de produção da `main`.
> **Modo piloto de e-mail confirmado em produção** (27/10/2026, pela tela de um evento: "Modo piloto ativo" e envio
> manual redirecionado à caixa de teste), e confirmado por leitura do código que todo envio automático e lembrete
> passa pela mesma guarda (`modo-de-envio-producao.md`).
> **Gmail Inbound Sync** voltou a passar na primeira execução agendada com o código novo (27/10, 05:52 UTC): 33 de 34
> mensagens processadas e 1 ignorada por 404 (aviso, não falha); ver `diagnostico-gmail-inbound-sync.md`.
> **Ainda NÃO declarado independente do notebook:** falta acessar e operar o sistema a partir de outro computador
> (`verificacao-outro-computador.md`) e os testes reais (Gmail/Outlook/iPhone/Android). O ambiente Preview da Vercel
> ainda usa o Supabase de produção.
>
> Documentos relacionados (mesma pasta): `inventario.md`, `pendencias.md`, `dependencias-locais.md`,
> `variaveis.md`, `guia-configuracao-e-recuperacao.md`, `estado-das-frentes.md`, `organizacao-de-branches.md`,
> `validacao-checkout-limpo.md`.

## 1. Tabela de transição por função

| Função | Estado atual | Dependência local identificada | Solução preparada | Teste executado | Pendência para ficar disponível remotamente |
|---|---|---|---|---|---|
| **Código-fonte** | 51 commits só no notebook (`feat/novo-projeto-acc` sem upstream) | Todo o trabalho recente existe só neste clone | Branch organizada; pendências examinadas e versionadas por assunto (`pendencias.md`); `.gitignore` portátil | Checkout limpo (`validacao-checkout-limpo.md`) | **Push** da branch (autorização) → PR → merge na `main` |
| **Upload e armazenamento de documentos/anexos** | Supabase Storage (`project-documents`, privado) + registro em banco | Nenhuma no código de produção; disco só em `os.tmpdir()` efêmero | Já remoto; políticas por obra | Replay no stack local (upload/download por obra, negação entre obras); testes de anexos com arquivos fictícios | Confirmar buckets e políticas no projeto remoto |
| **Extração, OCR e revisão de cláusulas** | Workers em GitHub Actions (extração/OCR, `.mpp` com Java/mpxj) + telas no ACC | Nenhuma de runtime; PDFs de contrato ficam só em `.claude/` neste notebook (fora do Git, por segurança) | Já remoto; falha fica em status `FAILED` | Testes de cobertura de extração (fictícios) | Alerta ativo para falha de worker (não existe); OCR real só testável no runner |
| **Relatórios semanais e XLSX** | Workflow de ingestão semanal + leitor `read-workbook.ts` | Nenhuma | Leitor em memória só para pacotes ≤ 2 MB, streaming acima; verificação do tamanho real descompactado; reversão preparada (`prep/revert-xlsx-in-memory-read`) | `test-weekly-workbook-reader` (10), planilha semanal real lida só em cópia isolada | Mais planilhas reais pequenas para confirmar a correção do Node 24 |
| **Gmail (entrada) e ata** | Sync inbound em GitHub Actions; token OAuth em segredo do servidor | `client_secret_*.json` na raiz do notebook (fora do Git) e script de autorização local | `.gitignore` versionado; guia de recuperação; correção do 404 de ata na principal | Testes simulados do worker | Guardar o `client_secret` no gerenciador de senhas; decidir `fix/gmail-ata-404` × principal (não publicar as duas) |
| **Envio de alertas e recorrência** | Código pronto; lembretes por GitHub Actions → `/api/cron/alert-reminders` | `alert-reminders.yml` só existe nesta branch (não está na `main`) | Workflow versionado; lote por obra e destinatário; modo piloto preservado | `test:scripts`, `test:email`, `test:sql` (cenário 3 de 4, recorrência, execução atrasada) | Merge na `main`; `CRON_SECRET` e `ACC_APP_BASE_URL` (GitHub); `AXION_APP_BASE_URL` (Vercel); plano de minutos do GitHub; e-mails em Gmail/Outlook reais |
| **Consulta aos especialistas de IA** | Rota no ACC; chave só no servidor | Nenhuma | Provedor simulado em todas as suítes; bloqueio de chamadas reais (`block-live-ai`) | `test-alert-ai-consult` (23) e consulta de SSMA (5), sem rede | `ANTHROPIC_*` no servidor; teste real só com habilitação explícita (`test:live-ai`) |
| **SSMA/PWA (fotos, fila offline, sincronização)** | Primeira versão pronta; dados sincronizados ficam no Supabase | Fila fica no aparelho (necessário para uso sem sinal); `sw.js` e manifest precisavam sair do proxy de autenticação (agora versionado em `a98f64e`) | Migration `20261028130000`; URL do PWA configurável; QR só com URL | `test:ssma` (lógica, fila, SQL, IndexedDB e service worker reais em Chrome), stack Supabase descartável | `ACC_SSMA_PWA_URL`; testar em iPhone e Android reais (câmera, instalação, offline) |
| **Obras, colaboradores, riscos e prazos (configuração)** | Banco (Supabase) + telas | Nenhuma | Criação e edição de projeto versionadas (`e5e3579`, migration `20261014190000`) | `test-create-project-workspace-sql` (5) | Aplicar a migration **antes** do código; dados NEWPORT a confirmar |
| **Classificação de risco** | Sugestão, revisão com justificativa e histórico | Nenhuma | Migration `20261028120000`; critérios nos prompts | `test-risk-classification` (15), SQL (10) | Aplicar a migration; revisão por pessoa autorizada em uso real |
| **Providências, D−60, CNO** | Pronto | Nenhuma | Migrations `…130000`, `…150000`, `…160000` | `test-delivery-*` e SQL | Aplicar migrations; NEWPORT: data de início e responsáveis |
| **Migrations e implantação** | 117 no repositório (109 em `origin/main`); estado do banco remoto não comprovado pelo repositório | `supabase/.temp` (vínculo local) e bancos Docker locais | Bootstrap de privilégios para inicialização limpa; ferramenta do stack descartável; ordem documentada | Replay de 117/118 em PGlite e em Supabase local descartável (Postgres, Auth, Storage) | Conferir no painel do Supabase o que está aplicado; aplicar em teste e depois produção |
| **Deploy do app** | Vercel (forma de deploy não está no repositório) | `.vercel/` local (recriável com `vercel link`) | Guia de implantação e verificações | Build limpo no checkout | Confirmar integração Git × deploy manual; variáveis definidas na Vercel |

## 2. Plano concreto de publicação (somente com sua autorização, nesta ordem)

1. **Antes de tudo:** guardar fora do notebook o que não está no Git — `client_secret_*.json` e a lista de variáveis
   (gerenciador de senhas) e os dois PDFs do contrato NEWPORT (armazenamento seguro, **não** no repositório).
2. **Cópia de segurança da branch:** `git fetch origin && git log --oneline HEAD..origin/main` (confirmar que a
   `main` não andou) → `git push -u origin feat/novo-projeto-acc` (cópia de segurança; sem PR ainda).
   Decidir sobre `fix/gmail-ata-404`: **não** publicar junto com a correção equivalente da principal.
3. **Banco de teste Supabase (remoto, não produção):** aplicar, em ordem, `20261014190000` (projeto) →
   `20261027120000` → `…130000` → `…140000` → `…150000` → `…160000` → `20261028120000` → `20261028130000`
   (`guia-configuracao-e-recuperacao.md`, seção 7). Verificar: tabelas com RLS ligada, funções
   `SECURITY DEFINER` com `search_path = ''`, `supabase db push --dry-run` antes de cada aplicação.
4. **Teste em ambiente de preview:** deploy de preview da branch apontando para o banco de TESTE, com
   `ACC_OUTBOUND_MODE` fora de `production` (modo piloto); rodar o `roteiro-testes-reais.md` (e-mails, PWA,
   offline) com dados fictícios.
5. **PR e merge** (`organizacao-de-branches.md`, opção A: um PR com revisão por assunto).
6. **Produção:** aplicar as mesmas migrations (mesma ordem), publicar o código e conferir as variáveis
   (`variaveis.md`). **Migration `20261014190000` antes do código** (o botão de criar projeto chama a função).
7. **Agendamentos:** só depois do merge ativam-se `alert-reminders` e demais workflows novos; conferir `CRON_SECRET`,
   `ACC_APP_BASE_URL` e o plano de minutos do GitHub; manter o modo piloto até decisão expressa.
8. **Verificações posteriores:** login e troca de obra; upload e leitura de um documento fictício; execução manual de
   um worker; um lote de alerta no piloto (assunto e destino `crm@axion.com.br`); instalação do PWA e envio de um
   registro fictício; consulta de IA simulada; revisar logs de falha dos workflows.
9. **Prova de independência:** abrir o projeto em **outro computador** seguindo `guia-configuracao-e-recuperacao.md`
   (clone, `npm ci`, `vercel link`/`env pull`, testes) e acessar o ACC remoto. Só então registrar que a operação não
   depende mais do notebook.

## 3. O que continua dependendo de serviços reais ou de aparelhos

- Gmail/Outlook/celulares reais (e-mails); iPhone e Android (PWA, câmera, offline).
- OCR em runner real, Storage e Auth reais do projeto remoto, Drive e Gmail (OAuth).
- Anthropic real (consulta de IA) — só com `ACC_ALLOW_LIVE_AI_TESTS=1` e chave no servidor.
- Banco remoto de teste: o replay local não cobre GoTrue/Storage/Realtime completos nem divergências do remoto.

## 4. Decisões suas pendentes

- Publicar a branch (e como: um PR ou fatiado) e o destino de `fix/gmail-ata-404`.
- Se `scripts/autorizar-gmail-reynaldo.mjs` entra no repositório.
- Mapeamento ADMINISTRATIVO → Documentação e Entrega; assunto/escopo restantes.
- Plano de minutos do GitHub e alerta de falha para os workers de documentos e `.mpp`.
- NEWPORT: data de início (19/10 ou 23/10), término 15/08/2027, responsáveis e riscos do checklist, 50 páginas sem
  leitura e 315 cláusulas pendentes.
