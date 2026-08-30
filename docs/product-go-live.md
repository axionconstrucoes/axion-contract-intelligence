# Startup Oficial do ACC

## Data oficial de início operacional

**02/09/2026, quarta-feira** (`2026-09-02`, America/Sao_Paulo).

Atualizado nesta rodada a partir de 24/08/2026. Regras associadas a
este marco:

- ambiente de teste/validação segue até o fim de 01/09/2026;
- assembleia geral/apresentação, startup/go-live e liberação de
  usuários ocorrem em 02/09/2026;
- a remoção da etiqueta global "SISTEMA EM TESTE" (`lib/test-mode.ts`)
  continua sendo **sempre manual** (`NEXT_PUBLIC_ACC_TEST_MODE=false` +
  novo deploy) — deliberadamente **não** amarrada automaticamente a
  este marco nem a relógio/data nenhuma (ver comentário em
  `lib/test-mode.ts`).

## Configuração

`apps/web/lib/acc-go-live.ts` — fonte única de verdade:

```ts
export const ACC_GO_LIVE_DATE = "2026-09-02" as const;
export function getAccGoLiveDate(): Date;      // meia-noite UTC do marco, como Date
export function isBeforeAccGoLive(date: Date): boolean;
```

Qualquer funcionalidade futura que precise se referir ao início
operacional do produto (Dashboard, relatórios, filtros, Manual,
"métricas desde o início operacional") deve importar daqui — nunca
hardcodar a data em outro lugar.

## O que este marco NÃO é

Este marco é exclusivamente uma referência do **produto** — quando o
ACC formalmente entrou em operação. Ele **nunca** deve ser usado para
alterar, reinterpretar ou filtrar:

- `created_at` histórico de qualquer registro;
- migrations já aplicadas;
- a trilha de auditoria (`audit_log_entries`);
- datas de documentos já versionados;
- eventos históricos do Event Ledger;
- e-mails históricos.

Todos esses continuam com suas datas reais, sempre — o marco de
go-live é puramente informativo/de corte para relatórios e métricas
futuras, nunca uma reescrita de dado existente.

### Não confundir com `projects.acc_operational_start_date`

`acc_operational_start_date` (migration
`supabase/migrations/20260823090000_startup_historical_review.sql`) é
um campo **configurável por projeto** — cada obra define, na própria
aba Start-up, a partir de quando o ACC passa a operar
prospectivamente para ELA (usado só para classificar findings como
históricos). O default `2026-08-24` gravado naquela migration já
aplicada é apenas o valor inicial desse campo de negócio por contrato
— não é, e nunca foi, o marco global de lançamento do produto descrito
nesta página, e a migration não é (nem deve ser) alterada
retroativamente por causa da mudança de data acima.

## Uso nesta fase

Nesta fase, a constante foi criada e documentada, mas **não foi
conectada ao Dashboard nem a nenhuma tela** — isso é trabalho futuro,
deliberadamente fora do escopo desta tarefa (não é necessário
redesenhar o Dashboard agora).
