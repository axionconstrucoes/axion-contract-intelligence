# Alertas recorrentes e tabela de providências — guia de implantação

> **Nada disto foi aplicado em banco nem publicado.** As migrations abaixo estão **preparadas e
> testadas localmente** (PostgreSQL descartável via PGlite) e **não foram aplicadas** em nenhum
> banco real. O comportamento contra o schema de produção continua sem validação.

## O que existe

| Parte | Onde |
|---|---|
| Política de repetição (1/2/4/7 dias; 24/48/96/168 h; textos "Repete: …") | `apps/web/lib/alerts/repeat-policy.ts` |
| Caixas de alerta (logo oficial, cores, borda de 2px, botões compactos 138×34 px, coluna branca de 154 px) | `apps/web/lib/email/templates/alert-box-style.ts` |
| Motor do acompanhamento recorrente (especificação executável) | `apps/web/lib/alerts/followup-engine.ts` |
| Funções SQL do acompanhamento | `supabase/migrations/20261027120000_alert_followups.sql` |
| Tabela de providências (SQL) | `supabase/migrations/20261027130000_project_delivery_items.sql` |
| Resposta PARCIAL de lote (SQL) | `supabase/migrations/20261027140000_alert_batch_partial_responses.sql` |
| Ações do alerta de providência (SQL) | `supabase/migrations/20261027150000_delivery_item_respond.sql` |
| Histórico da mudança do término previsto (SQL) | `supabase/migrations/20261027160000_delivery_end_date_change_history.sql` |
| Origem verificável de cláusula/evidência (links, "Pendente de confirmação") | `apps/web/lib/alerts/alert-source-links.ts`, `load-event-alert-context.ts` |
| Acompanhamento do e-mail individual manual | `apps/web/lib/alerts/manual-alert-tracking.ts` |
| Regras de providências, D−60 e CNO (especificação executável) | `apps/web/lib/delivery/delivery-items.ts` |
| Agendador (GitHub Actions → `/api/cron/alert-reminders`) | `.github/workflows/alert-reminders.yml` |
| Tela | `/{projeto}/providencias` |

## Ordem obrigatória de implantação

1. Aplicar `20261027120000_alert_followups.sql` (a tabela de providências depende dela).
2. Aplicar `20261027130000_project_delivery_items.sql`.
3. Aplicar `20261027140000_alert_batch_partial_responses.sql` (depende das tabelas de lote `20260921130000`, já existentes, e de 1).
4. Aplicar `20261027150000_delivery_item_respond.sql` (depende de 1 e 2).
5. Aplicar `20261027160000_delivery_end_date_change_history.sql` (depende de 2).
6. Publicar o código (a página de providências degrada com aviso se a migration ainda não existir).
7. Só então o workflow de lembretes passa a ter o que processar.

## Frequência real do agendamento

O GitHub Actions **não garante pontualidade**. No workflow *Gmail Inbound Sync* (agendado a cada
15 min) o intervalo real observado entre execuções foi de **~2 a 5 horas**. O motor foi desenhado
para isso: o calendário é ancorado na grade do primeiro envio e uma execução atrasada envia **um**
lembrete por alerta (nunca acumula). Não prometa precisão de horário: a repetição "a cada 1 dia" do
risco crítico pode atrasar algumas horas.

## Como testar sem tocar em banco real

- `npm run test:scripts` e `npm run test:email` — regras, templates e integrações (sem rede).
- `npm run test:sql` — as migrations contra PostgreSQL descartável em memória (PGlite). O schema é
  um **stub mínimo** do Supabase: valida sintaxe, constraints, RLS e a lógica das funções novas, mas
  **não** o schema real de produção.

## Regra do CNO (providência de início)

Fonte oficial consultada: Receita Federal — "no prazo de 30 (trinta) dias contados do início das
atividades de construção" (https://www.gov.br/receitafederal/pt-br/assuntos/construcao-civil/cno/cno).
A página não cita o número da norma. O prazo continua configurável (dias legais e prazo interno
antecipado). **Com datas de início divergentes** (ex.: cadastro 19/10/2026 × histórico 23/10/2026) o
prazo legal **não é calculado**; só um prazo interno informado manualmente vale até a decisão.

## Limites conhecidos

- O e-mail **individual manual** mostra os mesmos três botões (RESOLVIDO / EM ANDAMENTO / ENVIADO P/)
  quando o destinatário é membro ativo da obra (o envio registra um lote de um item e abre o
  acompanhamento). Sem isso, o e-mail segue só com os botões por token existentes. Com acompanhamento
  válido as ações por token continuam disponíveis como "Outras ações".
- Alertas de providência têm os três botões (página própria, confirmação explícita). **RESOLVIDO =
  concluir a providência**: exige gestor/gerente/administrador e evidência ou justificativa; um
  colaborador sem essa autoridade só pode EM ANDAMENTO ou ENVIADO P/ (a página explica).
- Evidência de providência no e-mail abre a linha da tabela (registro verificável), não o arquivo.
- Alertas de evento só têm cláusula quando há vínculo APROVADO evento↔cláusula; sem ele o e-mail
  mostra "Pendente de confirmação" (nunca uma cláusula inferida).
- Lembretes de alerta pendente chegam como e-mails separados por alerta (um acompanhamento por alerta).
- A mudança do término previsto recalcula os marcos automaticamente (cálculo sem estado) e a
  migration `20261027160000_delivery_end_date_change_history.sql` (gatilho em `projects`) grava
  `END_DATE_CHANGED` no histórico de cada providência da obra, com quem alterou e as datas antiga e
  nova, qualquer que seja o caminho de edição. Atrasos já registrados continuam vencidos.
- Não validado em clientes de e-mail reais (Gmail, Outlook, celulares) — só HTML renderizado no Chrome.
