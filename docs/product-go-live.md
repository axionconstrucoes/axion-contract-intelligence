# Startup Oficial do ACC

## Data oficial de início operacional

**24/08/2026** (`2026-08-24`).

## Configuração

`apps/web/lib/acc-go-live.ts` — fonte única de verdade:

```ts
export const ACC_GO_LIVE_DATE = "2026-08-24" as const;
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

## Uso nesta fase

Nesta fase, a constante foi criada e documentada, mas **não foi
conectada ao Dashboard nem a nenhuma tela** — isso é trabalho futuro,
deliberadamente fora do escopo desta tarefa (não é necessário
redesenhar o Dashboard agora).
