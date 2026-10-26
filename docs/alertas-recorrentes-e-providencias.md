# Alertas recorrentes e tabela de providências — guia de implantação

> **Nada disto foi aplicado em banco nem publicado.** As migrations abaixo estão **preparadas e
> testadas localmente** (PostgreSQL descartável via PGlite) e **não foram aplicadas** em nenhum
> banco real. O comportamento contra o schema de produção continua sem validação.

## O que existe

| Parte | Onde |
|---|---|
| Política de repetição (1/2/4/7 dias; 24/48/96/168 h; textos "Repete: …") | `apps/web/lib/alerts/repeat-policy.ts` |
| Caixas de alerta (logo oficial, cores, borda de 2px, botões compactos 117×32 px) | `apps/web/lib/email/templates/alert-box-style.ts` |
| Motor do acompanhamento recorrente (especificação executável) | `apps/web/lib/alerts/followup-engine.ts` |
| Funções SQL do acompanhamento | `supabase/migrations/20261027120000_alert_followups.sql` |
| Tabela de providências (SQL) | `supabase/migrations/20261027130000_project_delivery_items.sql` |
| Regras de providências, D−60 e CNO (especificação executável) | `apps/web/lib/delivery/delivery-items.ts` |
| Agendador (GitHub Actions → `/api/cron/alert-reminders`) | `.github/workflows/alert-reminders.yml` |
| Tela | `/{projeto}/providencias` |

## Ordem obrigatória de implantação

1. Aplicar `20261027120000_alert_followups.sql` (a tabela de providências depende dela).
2. Aplicar `20261027130000_project_delivery_items.sql`.
3. Publicar o código (a página de providências degrada com aviso se a migration ainda não existir).
4. Só então o workflow de lembretes passa a ter o que processar.

## Frequência real do agendamento

O GitHub Actions **não garante pontualidade**. No workflow *Gmail Inbound Sync* (agendado a cada
15 min) o intervalo real observado entre execuções foi de **~2 a 5 horas**. O motor foi desenhado
para isso: o calendário é ancorado na grade do primeiro envio e uma execução atrasada envia **um**
lembrete por alerta (nunca acumula). Não prometa precisão de horário: a repetição "a cada 1 dia" do
risco crítico pode atrasar algumas horas.

## Limites conhecidos

- O e-mail **individual manual** (formulário do evento) mantém os botões por token existentes
  (DAR CIÊNCIA etc.) e só mostra "Repete" quando há acompanhamento ativo; os quatro botões
  VER EVENTO / RESOLVIDO / EM ANDAMENTO / ENVIADO P/ existem no e-mail de lote.
- Alertas de providência não têm botões no e-mail: o link abre a linha da tabela (registro único).
- A mudança do término previsto recalcula os marcos automaticamente (cálculo sem estado), mas o
  registro `END_DATE_CHANGED` no histórico ainda não é gravado pela tela de edição da obra.
- O prazo do CNO (30 dias a partir do início da obra) é uma **referência a confirmar** no texto
  oficial vigente (fontes secundárias; norma primária não verificada).
- Não validado em clientes de e-mail reais (Gmail, Outlook, celulares) — só HTML renderizado no Chrome.
