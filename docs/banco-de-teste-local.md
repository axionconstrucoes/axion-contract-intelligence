# Banco de teste local (Docker) — validação das migrations

> **Nenhuma migration foi aplicada em produção/banco remoto.** Tudo abaixo roda em containers Docker
> locais (`127.0.0.1`). O repositório está vinculado a um projeto remoto (`supabase/.temp/project-ref`):
> **nunca** use `supabase link`, `db push`, `--linked` nem `db remote` nestes testes.

## Como iniciar o ambiente

1. Abra o **Docker Desktop** (`C:\Program Files\Docker\Docker\Docker Desktop.exe`) e aguarde o daemon
   (`docker info` deve mostrar `Server Version`). O WSL2 (Ubuntu) precisa estar ativo.
2. Se o Docker Desktop reiniciar containers antigos sozinho, confira com `docker ps -a`.

## Ambientes locais identificados (2026-10-26)

| Container | Porta local | Papel | Estado das migrations |
|---|---|---|---|
| `supabase_db_axion-contract-intelligence` (+ stack Supabase completa) | 54322 (API 54321) | Desenvolvimento local do projeto | 95 aplicadas (até `20260917130000`) — **não alterado** |
| `supabase_db_acc-disposable-test-e2` | 56322 | **Descartável** (usado pelos runners `scripts/sql/run-*-test.mjs`) | **117/117** após o replay abaixo |

O banco de desenvolvimento local guarda dados de trabalho; por isso **não** foi usado `supabase db reset`
(apagaria esses dados). O replay foi feito só no banco descartável, com `pg_dump` prévio.

## Replay em ordem (resultado)

`scripts/sql/replay-pending-migrations-disposable.sh` aplica, em ordem e cada uma em transação, as
migrations ainda não registradas em `supabase_migrations.schema_migrations`, e **recusa** qualquer container
cujo nome não comece com `supabase_db_acc-disposable-`.

- 42 pendentes (75 → 117), incluindo as 7 novas (`20261027120000`…`160000`, `20261028120000`, `20261028130000`).
- Verificado no Postgres real: 117 registradas; **0 tabelas de `public` sem RLS**; policies das tabelas
  novas presentes; funções e gatilhos novos criados.
- Teste funcional em transação com `ROLLBACK`: `delivery_items_seed_checklist` como administrador real
  (papel `authenticated`) criou 14 itens; alterar `projects.baseline_end_date` gerou 14 eventos
  `END_DATE_CHANGED`; após o rollback, 0 itens.

## Achado: `20260920170000_harden_weekly_report_database_permissions` depende de privilégios padrão antigos

A migration assume que as 9 tabelas criadas por `20260920120000` herdam do schema `public` os privilégios
padrão do projeto hospedado (`ALL` para `anon/authenticated/service_role`). Nos stacks locais atuais o padrão
de `postgres` em `public` é só `Dxtm` (sem SELECT/INSERT/UPDATE/DELETE), então o auto-teste da própria migration
falha com `hardening falhou: authenticated perdeu SELECT em project_weekly_schedule_ingestion_configs`.
No banco descartável foi emulado o padrão hospedado (`ALTER DEFAULT PRIVILEGES … GRANT ALL`) e as 9 tabelas
receberam `GRANT ALL` antes de reaplicar; a migration então passou.

**Impacto:** um `supabase db reset --local` limpo, ou um projeto Supabase novo criado com os padrões
restritivos atuais, **falha nessa migration**. O banco remoto existente não é afetado (já aplicada).
**Solução preparada (sem reescrever histórico aplicado):** bootstrap versionado fora das migrations, usado por
`scripts/sql/start-clean-local-stack.mjs` num stack descartável identificado (`acc-disposable-*`, portas 57xxx).
Opções A–D, impactos, recomendação e resultados (PostgreSQL, Auth e Storage, **118/118** migrations em
inicialização limpa) em `docs/migration-privilegios-inicializacao-limpa.md`.

## Limites desta validação

Só o Postgres (com schemas `auth`/`storage` reais da imagem) foi usado no banco descartável; os demais
serviços (GoTrue, Storage, Realtime) não rodam nele. Não substitui um teste ponta a ponta num Supabase local
completo, que exige resolver o achado acima (ou emular os privilégios) antes do `db reset`.
