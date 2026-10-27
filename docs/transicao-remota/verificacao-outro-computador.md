# Verificação a partir de outro computador e retomada do desenvolvimento

> Estado em 27/10/2026: produção em `main` `44571fe`. **Esta verificação ainda não foi feita.** Só depois de executada
> (e registrada abaixo) o ACC pode ser declarado independente do notebook.

## A. Conferir a produção em outro computador autorizado (10 minutos, sem alterar dados)

Use um computador que **nunca** tenha aberto o projeto, com navegador atual.

| # | Passo | Resultado esperado |
|---|---|---|
| 1 | Abrir `https://acc.axion.com.br` | Redireciona para `/login` |
| 2 | Entrar com a sua conta | Abre a seleção de obras (`/projetos`) |
| 3 | Selecionar uma obra | Painel da obra; menu lateral completo; você só vê obras de que participa |
| 4 | **Documentos** → abrir um documento já existente e uma versão | Lista e detalhe carregam; arquivo abre (URL assinada) |
| 5 | Documentos → aba **Cláusulas** (ou `/{obra}/revisao-clausulas`) | Cláusulas existentes aparecem com a fonte |
| 6 | **EVENTOS** (`/{obra}/ledger`) e um evento | Lista e detalhe; sem enviar nada (não use "enviar e-mail") |
| 7 | **Providências** (`/{obra}/providencias`) | Tela abre; tabela vazia ou com o checklist se já semeado; **não** semear nem editar em produção só para testar |
| 8 | **ESG/SSMA** → painel de registros (`/{obra}/ssma-registros`) | Tela abre (sem registros ainda) |
| 9 | No celular, abrir `https://acc.axion.com.br/ssma` | Pede login e mostra só as suas obras; instalar o PWA conforme `docs/modulo-seguranca-pwa.md` |
| 10 | Registrar o resultado neste arquivo (data, computador, o que abriu, o que falhou) | — |

Não criar alertas, não enviar e-mails, não usar CONSULTAR IA com IA real (custo). Se algo falhar, anote a tela e a hora
e consulte os logs da Vercel (*Observability → Runtime Logs*).

**Registro da verificação:** _(preencher: data, computador, resultado)_

## B. Retomar o desenvolvimento pelo GitHub

```bash
git clone https://github.com/axionconstrucoes/axion-contract-intelligence.git
cd axion-contract-intelligence
git switch main && git pull --ff-only          # a main é a versão única em produção
git switch -c feat/<assunto>                    # trabalhe sempre em branch própria
npm ci
cp apps/web/.env.example apps/web/.env.local    # preencher por `vercel env pull` (ver variaveis.md) — nunca versionar
env -u ANTHROPIC_API_KEY npm run lint && npm run build && npm test && npm run test:scripts && npm run test:email && npm run test:ssma
git push -u origin feat/<assunto>               # abre preview na Vercel
```

Cuidados:
- O ambiente **Preview** da Vercel usa o Supabase de **produção**: não use o preview para testar fluxos que gravam dados
  (ver `aplicacao-migrations-producao.md` e o plano de separação abaixo).
- Migrations: criar o arquivo em `supabase/migrations`, testar com `npm run test:sql` e no stack descartável
  (`scripts/sql/start-clean-local-stack.mjs up`), e **só aplicar em produção** com `supabase db push --linked` depois de
  `--dry-run` e de confirmar o backup (Supabase → Database → Backups).
- Só faça merge na `main` depois de o build do preview passar; o merge publica em produção automaticamente.

## C. Arquivos e credenciais que só existem neste notebook

| Item | Onde guardar com segurança |
|---|---|
| `client_secret_*.json` na raiz (OAuth do Gmail) | Gerenciador de senhas da empresa (anexo seguro); nunca no Git |
| `apps/web/.env.local` e `.env.local` da raiz (cópias de segredos) | Não copiar: recriar com `vercel env pull` / consultar `variaveis.md`; os segredos de produção já estão na Vercel e no GitHub Secrets |
| Login do CLI do Supabase / Vercel / GitHub deste notebook | Em outro computador: `supabase login`, `vercel login`, `gh auth login` com a sua conta |
| `scripts/autorizar-gmail-reynaldo.mjs` (excluído por `.git/info/exclude`) | Decisão pendente: versionar (sem segredos) ou guardar no gerenciador de senhas |
| Contrato NEWPORT (2 PDFs em `.claude/`) | **Já estão no Storage de produção** (hash idêntico: parte 1 ativa; parte 2 reclassificada como "Parte 2 de 2" do contrato base e registro duplicado na lixeira). Não duplicar |
| Stash `checkpoint-email-pilot-2026-09-23`, worktree `fix/gmail-ata-404`, branch `prep/revert-xlsx-in-memory-read`, `docs/prompt-claude-code.md`, `.claude/ui-redesign-axion.md` | Só neste notebook, por decisão; não publicar sem revisão |

## D. Plano de separação do Preview (não executado — altera configuração)

1. Criar um segundo projeto Supabase (ou *branch* de banco) de teste e aplicar nele as migrations em ordem.
2. Na Vercel → *Environment Variables*, trocar as variáveis marcadas para **Preview** (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) pelos valores do banco de teste; manter `ACC_OUTBOUND_MODE`
   fora de `production` nesse ambiente.
3. Conferir um preview novo (login com usuário de teste) e só então liberar testes autenticados no preview.
4. Recuperação: valores anteriores ficam no histórico da variável na Vercel; reverter é editar a variável e refazer o deploy.
