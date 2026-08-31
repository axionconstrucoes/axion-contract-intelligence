# Startup Oficial do ACC

## Data e hora oficiais de início operacional

**07/09/2026, segunda-feira, 09:00** (`2026-09-07T09:00:00`,
America/Sao_Paulo).

Atualizado nesta rodada a partir de 02/09/2026 00:00 UTC. Regras
associadas a este marco:

- até 07/09/2026 08:59:59 (America/Sao_Paulo), o sistema permanece em
  teste;
- a partir de 07/09/2026 09:00 (America/Sao_Paulo): início oficial da
  operação;
- a partir do mesmo instante, a etiqueta global "SISTEMA EM TESTE"
  (`lib/test-mode.ts`) deixa de ser exibida **automática e
  incondicionalmente** — diferente da fase anterior deste marco, em que
  a remoção era deliberadamente sempre manual. Antes do marco, a regra
  manual fail-safe (`NEXT_PUBLIC_ACC_TEST_MODE=false` + novo deploy)
  continua valendo normalmente.

## Configuração

`apps/web/lib/acc-go-live.ts` — fonte única de verdade:

```ts
export const ACC_GO_LIVE_DATE = "2026-09-07" as const;
export const ACC_GO_LIVE_TIME = "09:00:00" as const;
export const ACC_GO_LIVE_TIMEZONE = "America/Sao_Paulo" as const;
export function getAccGoLiveDate(): Date;              // instante UTC exato do marco, como Date
export function isBeforeAccGoLive(date: Date): boolean;
export function hasAccGoLiveOccurred(date?: Date): boolean;
```

A conversão do horário de parede (09:00, America/Sao_Paulo) para o
instante UTC usa `Intl.DateTimeFormat` (ICU) — nunca um offset fixo
manual nem o timezone do servidor/processo. `apps/web/lib/test-mode.ts`
usa `hasAccGoLiveOccurred()` para decidir automaticamente se a etiqueta
"SISTEMA EM TESTE" deve ser exibida.

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

Nesta fase, a constante está conectada apenas à etiqueta global
"SISTEMA EM TESTE" (`lib/test-mode.ts`) — ainda não foi conectada ao
Dashboard nem a nenhuma outra tela. Isso continua sendo trabalho
futuro, deliberadamente fora do escopo desta rodada.

## Histórico

- **2026-08-24 → 2026-09-02:** primeira definição do marco (data sem
  horário, meia-noite UTC).
- **2026-09-02 → 2026-09-07 09:00 America/Sao_Paulo:** rodada atual —
  marco passa a incluir horário e timezone explícitos, e a etiqueta
  "SISTEMA EM TESTE" passa a se desligar automaticamente no instante do
  marco.
