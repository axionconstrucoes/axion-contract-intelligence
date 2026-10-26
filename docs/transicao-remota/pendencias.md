# As 35 pendências da árvore de trabalho — decisão por item

> Origem: `git status` no início deste trabalho (16 arquivos modificados + 19 entradas não rastreadas = **35**).
> Cada item foi lido (diff com `--ignore-all-space` nos modificados; conteúdo/cabeçalho nos não rastreados) e
> classificado. Nada foi apagado. Só código completo e coerente virou commit, com *staging* arquivo a arquivo.
> Verificação antes de commitar: `tsc` limpo, `lint` 0 erros, `test:scripts`, `test:sql` e testes relacionados verdes.
> Nenhum PDF, credencial, dado pessoal ou diagnóstico entrou no Git.

Classes: **A** = código de produto completo (commitado) · **B** = documento seguro, versionado como doc ·
**C** = artefato/documento local (não versionar) · **D** = sensível (jamais versionar).

## Resumo

| Resultado | Entradas |
|---|---|
| Commitadas (A/B) | **27** (16 modificadas + 11 não rastreadas) |
| Mantidas locais, ignoradas ou não rastreadas (C/D) | **8** |

## Código de produto — commitado (classe A)

| # | Item | O que é | Evidência | Commit |
|---|---|---|---|---|
| 1 | `apps/web/app/projetos/page.tsx` (M) | Seleção de projetos: botão "NOVO PROJETO", "Editar projeto" (só admin), estado vazio, número UNO | tsc/lint ok | `e5e3579` |
| 2 | `apps/web/app/projetos/actions.ts` (??) | Server Actions de criar/editar projeto; edição só de ADMINISTRADOR ativo, auditoria server-side, sem service-role para a escrita do cadastro | revisão de código; RLS/permissão checadas | `e5e3579` |
| 3 | `apps/web/app/projetos/actions-state.ts` (??) | Estados/retorno com destinos fixos (sem URL livre) | | `e5e3579` |
| 4 | `apps/web/app/projetos/novo/` (??) | Página de criação | | `e5e3579` |
| 5 | `apps/web/app/projetos/[projectId]/editar/` (??) | Página de edição, só admin | | `e5e3579` |
| 6 | `apps/web/components/projects/` (??) | Formulários de criar/editar | | `e5e3579` |
| 7 | `apps/web/app/[projectId]/layout.tsx` (M) | Passa `canEditProject` à barra superior | | `e5e3579` |
| 8 | `apps/web/components/layout/top-bar.tsx` (M) | Botão "Editar projeto" para admin | | `e5e3579` |
| 9 | `apps/web/app/[projectId]/startup/{actions,page}.ts(x)` (M) | Data de término da baseline no Start-up | | `e5e3579` |
| 10 | `apps/web/components/startup/startup-config-form.tsx` (M) | Campo "Data de término da baseline" | | `e5e3579` |
| 11 | `apps/web/lib/startup/{configure-startup,get-startup-summary,types}.ts` (M) | Leitura/gravação de `baseline_end_date`, validando término ≥ início | | `e5e3579` |
| 12 | `supabase/migrations/20261014190000_create_project_workspace.sql` (??) | RPC `create_project_workspace` (SECURITY DEFINER, `search_path=''`, só ADMINISTRADOR ativo) | **teste novo** `scripts/test-create-project-workspace-sql.mjs` (5/5 em PGlite) + replay de todas as migrations | `e5e3579` |
| 13 | `apps/web/app/[projectId]/revisao-clausulas/{actions,page}.ts(x)` (M) | Lista de cláusulas com filtros, paginação, conferência e retorno seguro (`returnTo` só dentro da própria revisão) | tsc/lint; `test-clause-review-order` | `6b131af` |
| 14 | `apps/web/components/clauses/` (??) | Formulário de revisão do candidato a cláusula | | `6b131af` |
| 15 | `apps/web/lib/clause-review-list.ts`, `clause-review-order.ts` (??) | Consulta/ordenação natural das cláusulas | `scripts/test-clause-review-order.mjs` 7/7 (agora em `test:scripts`) | `6b131af` |
| 16 | `scripts/test-clause-review-order.mjs` (??) | Teste da ordenação | 7/7 | `6b131af` |
| 17 | `.../contract-attachments/contract-attachments-panel.tsx`, `use-contract-attachments.ts` (M) | "Partes e anexos do contrato": identificação opcional e ordem de envio | `test-contract-attachments` 40/40 | `e2fd651` |
| 18 | `scripts/test-contract-attachments.mjs` (M) | Atualiza as expectativas dos textos novos | 40/40 | `e2fd651` |
| 19 | `apps/web/app/[projectId]/timeline/timeline-search-actions.ts` (M) | Busca no arquivo usa só a extração PROCESSED mais recente, texto normalizado e aviso de leitura parcial | tsc/lint; `test:scripts` | `c4f8a0e` |
| 20 | `apps/web/proxy.ts` (M) | **Exclui `sw.js` e `manifest.webmanifest` do proxy de autenticação** | `test-cron-routes-proxy-auth` 24/24 | `a98f64e` |

> **Item 20 é essencial ao PWA do SSMA**: sem ele o proxy exigiria login para o service worker e para o manifest e
> o app **não instalaria** em outro computador/aparelho. Estava só na árvore de trabalho deste notebook.

Os itens 1–12 formam uma única funcionalidade ("novo projeto/editar projeto"); a migration 12 precisa ser
aplicada **antes** de publicar o código (o botão chama a RPC). Ordem: `20261014190000` vem antes das `20261027+`.

## Documentos seguros — versionados (classe B)

| # | Item | Decisão | Commit |
|---|---|---|---|
| 21 | `docs/ui-redesign-axion.md` (??) | Especificação de redesign (tema escuro v2). Sem dados nem segredos; útil para quem retomar a interface em outro computador. **Proposta ainda não implementada.** | docs da transição |

## Mantidos locais (classes C/D) — não versionados

| # | Item | Classe | Por que não vai ao Git | Destino correto | Tratamento |
|---|---|---|---|---|---|
| 22 | `.claude/NEWPORT-C100-Contrato-Parte-1-de-2.pdf` (16 MB) | **D** | Contrato real do cliente (documento sensível e grande) | Supabase Storage (onde o ACC lê) / arquivo da empresa | `.gitignore`: `.claude/*.pdf` |
| 23 | `.claude/NEWPORT-C100-Contrato-Parte-2-de-2.pdf` (50 MB) | **D** | idem | idem | idem |
| 24 | `.claude/86e2617b-205f-49f8-bfa7-2126c8c18fce.txt` (1 MB) | C | Na verdade é uma **imagem PNG 1254×1254** salva como `.txt` (tamanho igual ao do logo oficial); artefato de sessão | — (o logo oficial já está em `apps/web/public/branding`) | `.gitignore`: `.claude/*.txt` |
| 25 | `diagnostico-aditivos-alertas.txt` (36 KB) | C | Cópia de código/migrations exportada para diagnóstico (já no Git); texto com codificação quebrada; sem e-mails/CPF/CNPJ/chaves (varredura por padrões) | — | `.gitignore`: `/diagnostico-*.txt` |
| 26 | `diagnostico-esquema-aditivos-alertas.txt` (50 KB) | C | idem (esquema de migrations) | — | idem |
| 27 | `LEIA-ME-ANTES.txt` | C | Nota de aplicação de um pacote ZIP "NOVO PROJETO ACC" sobre `ad6a7c3`; **obsoleta** (os arquivos agora estão em commits) | — | `.gitignore`: `/LEIA-ME-ANTES.txt` |
| 28 | `docs/prompt-claude-code.md` | C | Prompt pontual de uma tarefa visual já executada; sem valor para a manutenção | — | Permanece não rastreado (não ignorado) |
| 29 | `.claude/ui-redesign-axion.md` | C | Versão anterior (v1) da especificação; superada por `docs/ui-redesign-axion.md` (v2) | — | Permanece não rastreado |

Contagem: itens 1–21 cobrem 27 das 35 entradas do `git status` (alguns itens agrupam vários arquivos);
itens 22–29 são as 8 restantes.

## Regras `.gitignore` aplicadas (portáveis)

```
.claude/*.pdf
.claude/*.txt
/diagnostico-*.txt
/LEIA-ME-ANTES.txt
*.backup-*
/patch-*.py
/fix-formalizedVariation.py
```

`*.backup-*`, `patch-*.py` e `fix-formalizedVariation.py` já eram excluídos **só** por `.git/info/exclude`
(regra local, que não acompanha o repositório); agora estão no `.gitignore` versionado. Nenhum arquivo foi
removido ou movido.

## Fora das 35, mas relevante

| Item | Observação |
|---|---|
| `scripts/autorizar-gmail-reynaldo.mjs` | Ferramenta de OAuth sem segredos no corpo; excluída por `.git/info/exclude` (não aparece no `git status`). Decidir se vira script versionado (precisa de `client_secret_*.json` local). |
| `client_secret_*.json` (2 arquivos na raiz) | Credencial OAuth do Google. Ignorados corretamente; **guardar no gerenciador de senhas** — são necessários para refazer a autorização do Gmail em outro computador. |
| `stash@{0}` | Não faz parte das 35; ver `inventario.md`. |
