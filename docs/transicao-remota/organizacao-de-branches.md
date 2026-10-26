# Organização de branches e ordem de publicação (proposta)

> **Proposta documental.** Nenhuma branch nova foi criada, nada foi enviado ao remoto, nenhum PR/merge foi feito.
> Os comandos `git branch` abaixo são **sugestões não executadas**. Hashes conferidos em `git log`.

## 1. Situação verificada

- `origin/main` = `ad6a7c3` (10/10/2026). A branch de trabalho `feat/novo-projeto-acc` está **52 commits à frente** (contagem na data da última revisão; confirmar com `git log --oneline origin/main..HEAD`)
  e 0 atrás de `origin/main`, e **não existe no remoto** (nenhum `origin/feat/novo-projeto-acc`): hoje esses
  commits existem **somente neste computador**. Fazer o push da branch (com autorização) é o primeiro passo para
  a independência do notebook.
- Worktree isolada `fix/gmail-ata-404` (`458c82a`), 1 commit à frente de `origin/main`, não publicada. A correção
  equivalente já está na principal como `7f82687` + `416e7f2`.
- Branch local `prep/revert-xlsx-in-memory-read` (`4ac8ff2`): reversão preparada do leitor XLSX, **não aplicada**.
- 1 stash antigo (checkpoint do piloto de e-mail, de outra branch) e as pendências não commitadas (`pendencias.md`).
- Há muitas branches locais antigas (`feat/*`, `fix/*`) com ou sem par no remoto; **não** foram alteradas.
- Nenhum commit de merge no intervalo; histórico linear.

## 2. Commits por assunto (de `ad6a7c3` até o HEAD)

| Assunto | Commits (antigos → novos) |
|---|---|
| Base anterior à rodada (cobertura de extração/OCR, lint, teste de anexos) | `08ded4a`, `3ce8c7b`, `1f58b3e` |
| Gmail ata 404 | `7f82687`, `416e7f2` |
| E-mails de alerta (caixas, cores, botões, assunto por obra/destinatário, CONSULTAR IA no e-mail) | `bd556e6`, `bd7c215`, `fe6a845`, `e5ab1fb`, `14e65f2`, `266be09`, `b3f6466`, `02027b3`, `29aef9f`, `b7af61b`, `5dfa99b`, `a7a7a2f` |
| Recorrência e lote parcial | `58dfeb0`, `e735dda`, `9e4cef4` |
| Providências, CNO e histórico do término | `7dfa56e`, `d09263c`, `db3487d` (+ doc `e0750fb`) |
| CONSULTAR IA (página, especialistas) | `8272dc7`, `0b4677f` |
| Classificação de risco | `7c7c0d4`, `5cedc3d` |
| SSMA/PWA | `7faf1ee`, `ac256a3`, `472ad2a`, `5d79b71`, `46b86fd` |
| XLSX | `79fe57b`, `b869798` (+ parte de `cb0079e`) |
| Testes sem IA real | `2de5671` |
| Banco local e migrations | `177f083`, `9d373f6`, `ac136f5`, `f81a579` |
| Fontes (Black → negrito) | `5868330` (toca e-mails, ACC e SSMA) |
| Documentação/roteiro | `3fde2bc`, esta pasta |
| Misto | `cb0079e` (expectativas de testes + XLSX + prompt do planejamento + ajuda) |

## 3. Opções de publicação

**Opção A (recomendada, mais simples e segura):** publicar **uma** branch com todo o histórico e abrir **um** PR
para `main` com revisão por assunto (a tabela acima serve de roteiro de revisão). Motivo: os commits têm
dependências cruzadas e os testes foram ajustados ao conjunto (por exemplo, `5dfa99b`, `a7a7a2f` e `5868330`
mexem nos mesmos arquivos de teste de e-mail; `cb0079e` mistura assuntos).

**Opção B (PRs menores):** dividir por assunto com `git cherry-pick` em branches novas a partir de `origin/main`.
Exige resolver conflitos e ordem; só vale se a revisão precisar ser fatiada. Sugestão de ordem e branches
(**comandos para uso futuro, não executados**):

```powershell
# 0) publicar o estado atual como cópia de segurança (com autorização):
#    git push -u origin feat/novo-projeto-acc
# 1) marcos locais apontando para commits existentes (não alteram a branch atual nem o working tree):
git branch marco/base-extracao         1f58b3e
git branch marco/gmail-ata-404         416e7f2
git branch marco/alertas-emails-lote   a7a7a2f
git branch marco/providencias-cno      db3487d
git branch marco/consultar-ia          0b4677f
git branch marco/risco                 5cedc3d
git branch marco/ssma-pwa              46b86fd
git branch marco/xlsx                  b869798
git branch marco/db-local-migrations   f81a579
```

(Cada `marco/*` aponta para o **último commit do assunto no histórico linear**, logo contém também tudo o que
veio antes dele — servem de pontos de referência/corte, não de branches independentes.)

## 4. Ordem de merge e implantação sugerida

1. Revisão/decisão sobre o que **não** vai: `prep/revert-xlsx-in-memory-read` (apenas se a leitura em memória for
   rejeitada) e a frente "Novo projeto" (não commitada).
2. Push da branch → PR → merge na `main` (somente com autorização). Workflows agendados só passam a valer após o
   merge na `main`.
3. Migrations em **banco de teste** Supabase (ordem do `guia-configuracao-e-recuperacao.md`, seção 7), depois em
   produção com autorização.
4. Deploy do código (Vercel), conferir variáveis (`variaveis.md`), executar as verificações pós-deploy.
5. Só então ativar/observar os workflows de lembretes (`alert-reminders`) e lotes; manter `ACC_OUTBOUND_MODE` no
   modo piloto até decisão expressa.

## 5. Riscos

- **A branch principal existe só localmente** até o push — risco de perda se o notebook falhar.
- **`cb0079e` e `5868330` misturam assuntos**; `e0750fb` mistura doc de alertas e decisão do PWA.
- **Dependências entre commits:** os testes de e-mail foram atualizados em commits diferentes (`29aef9f`,
  `b7af61b`, `5dfa99b`, `a7a7a2f`, `5868330`); cherry-pick parcial quebra suítes.
- **Pendências antigas:** examinadas em `pendencias.md`; 27 foram versionadas por assunto (`e5e3579`, `6b131af`,
  `e2fd651`, `c4f8a0e`, `a98f64e`, `bdc9ac3`) e 8 permanecem locais de propósito (PDFs de contrato, diagnósticos).
- **Equivalência do Gmail:** `458c82a` (isolada) e `7f82687` (principal) alteram os mesmos arquivos mas **não têm o
  mesmo patch** (diferença em `package-lock.json`/`package.json`); não publicar as duas.
- **`main` antiga:** `origin/main` está em 10/10/2026; ao publicar, conferir que não houve commits novos no
  remoto (`git fetch` + `git log HEAD..origin/main`).
