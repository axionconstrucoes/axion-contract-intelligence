# Estado de cada frente

Base: `git log` da branch `feat/novo-projeto-acc` (HEAD `f81a579` ou posterior), os documentos de `docs/` citados e
os relatórios de teste da última rodada. **Pronta** = implementada, commitada e com testes automatizados verdes
com serviços simulados; **Precisa de teste** = falta validar em ambiente/cliente real; **Bloqueada** = há uma
dependência ou decisão pendente. Nada foi publicado, aplicado em banco real ou enviado.

| Frente | Estado | Evidência (commits / docs) | O que falta |
|---|---|---|---|
| E-mails de alerta por obra e destinatário (assunto, cores semáforo, cabeçalho/título maiores, CONSULTAR IA, 3 botões) | **Pronta** + **precisa de teste** em clientes reais | `02027b3`, `5dfa99b`, `a7a7a2f`, `5868330`; `test-alert-box-templates` (31) | Ver nos clientes **Gmail, Outlook, celulares**; layout lateral do CONSULTAR IA no celular depende de CSS (cai para vertical); `docs/roteiro-testes-reais.md` |
| Lote parcial (3 de 4) e recorrência (1/2/4/7 dias) | **Pronta** (PGlite) + precisa de teste no banco real | `e735dda`, `58dfeb0`, `9e4cef4`; `test:sql` | Migrations 1–4 da lista do guia em banco de teste Supabase; cron real só após merge na `main` |
| CONSULTAR IA (página no ACC) | **Pronta** com provedor simulado | `8272dc7`, `0b4677f`; `test-alert-ai-consult` (23) | Consulta real exige `ANTHROPIC_*` no servidor (não testada); mapeamento ADMINISTRATIVO → Documentação e Entrega **decisão do usuário** |
| Classificação de risco (critérios, sugestão, revisão com histórico) | **Pronta** (módulo + integração) | `7c7c0d4`, `5cedc3d`; `docs/classificacao-de-risco.md` | Migration `20261028120000`; prazo/vínculo contratual podem faltar (a sugestão pede confirmação) |
| Providências, D−60, CNO, histórico do término | **Pronta** (PGlite e banco local descartável) | `7dfa56e`, `d09263c`, `db3487d`; `docs/alertas-recorrentes-e-providencias.md` | NEWPORT: data de início (19/10 × 23/10), responsáveis e riscos **a definir pelo usuário** |
| SSMA/PWA (registro, fotos, fila offline, painel, QR) | **Pronta** na primeira versão; **precisa de teste em iPhone e Android** | `7faf1ee`, `ac256a3`, `472ad2a`, `5d79b71`, `46b86fd`; `docs/modulo-seguranca-pwa.md` | Testar em aparelhos reais (câmera, instalação, offline, troca de conta); definir `ACC_SSMA_PWA_URL`; limites: fotos JPG/PNG ≤15 MB, 20/registro, sem HEIC; andamento/conclusão exigem internet |
| Leitor de XLSX (relatório semanal) | **Pronta**; **precisa de teste** com mais planilhas pequenas reais | `cb0079e`, `79fe57b`, `b869798`; `docs/weekly-schedule-email-ingestion.md` | Reversão isolada **preparada e não aplicada** em `prep/revert-xlsx-in-memory-read` (`4ac8ff2`); limite de leitura em memória 2 MB |
| Gmail: 404 de mensagem/anexo (ata) | **Pronta** na branch isolada e equivalente na principal; **bloqueada** para publicação por decisão de integração | `fix/gmail-ata-404` `458c82a` (worktree isolada); na principal: `7f82687` + `416e7f2` | Decidir qual branch publicar (conjuntos de arquivos equivalentes; difere em `package-lock.json`); testar o worker com Gmail real |
| Banco e migrations | **Parcialmente validada** | `177f083`, `9d373f6`, `ac136f5`, `f81a579`; `docs/banco-de-teste-local.md`, `docs/migration-privilegios-inicializacao-limpa.md` | Aplicar as 7 migrations pendentes em **Supabase de teste remoto** e depois produção (autorização). GoTrue/Storage validados só no stack local descartável |
| Testes sem IA real | **Pronta** | `2de5671`; `docs/testes-sem-ia-real.md` | `npm run test:live-ai` só com habilitação explícita |
| Padronização de fontes (sem Black/900) | **Pronta** | `5868330`; `test-no-black-font-weight` | — |
| Falhas antigas de teste (branding, ajuda, registry, hub, financeiro) | **Pronta** (expectativas atualizadas) | `cb0079e`, `177f083` | Leitura XLSX em memória é correção de ambiente (Node 24) — ver XLSX |
| **Novo projeto (workspace)** e demais pendências antigas | **Pronta** (examinadas e versionadas) + **precisa de teste** no banco de teste | `e5e3579` (projeto + migration `20261014190000`), `6b131af` (revisão de cláusulas), `e2fd651` (partes/anexos), `c4f8a0e` (busca na timeline), `a98f64e` (PWA fora do proxy), `bdc9ac3`; `pendencias.md` | Aplicar a migration `20261014190000` **antes** do código; 8 itens locais (PDFs do contrato, diagnósticos) ficam fora do Git por decisão documentada |
| Itens operacionais antigos (Construmanager, Diário de Obra, Drive SSMA, sync Gmail, ingestão semanal) | **Existentes**; não alterados nesta rodada | workflows em `.github/workflows` | Conferir segredos e execução na `main`; `docs/weekly-schedule-email-ingestion.md` |

## Pendências transversais

- Nada foi aplicado em produção: migrations, deploy, agendamentos e credenciais ficam para a etapa de publicação.
- Clientes de e-mail e aparelhos reais: nenhum teste feito (somente Chrome).
- Decisões do usuário: ADMINISTRATIVO → Documentação e Entrega; assunto/escopo restantes; NEWPORT (início da obra,
  término 15/08/2027, responsáveis, riscos do checklist, 50 páginas sem leitura, 315 cláusulas pendentes).
