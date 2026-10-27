-- Reivindicação (lease) de envio da outbox de alertas de risco.
--
-- Problema: o envio relê a linha PENDING e envia. Dois ciclos sobrepostos (instâncias/execuções) podem
-- enviar a MESMA notificação duas vezes. Comparar apenas attempt_count não basta: um segundo ciclo que
-- começa DEPOIS que o primeiro reivindicou, mas antes de o primeiro concluir o envio, lê o contador já
-- incrementado e reivindica de novo (detectado por teste contra o SQL real).
--
-- Solução: a reivindicação grava claimed_at e só é concedida quando status = PENDING e não existe lease
-- vigente (claimed_at nulo ou mais antigo que o prazo do lease, definido pelo chamador). Um único UPDATE
-- condicional é atômico: o concorrente que esperava o lock reavalia o WHERE e atualiza 0 linhas.
-- Sucesso, falha e descarte limpam claimed_at; um ciclo que morreu no meio do envio libera a linha
-- quando o lease expira. Sem novo status e sem mudança de constraint (a UI e as RPCs existentes
-- continuam intactas).
--
-- ORDEM DE IMPLANTAÇÃO: aplicar esta migration ANTES de publicar o código que a usa. Sem a coluna, a
-- reivindicação falha e NADA é enviado (falha fechada) — nunca há envio duplicado por ausência da migration.

alter table public.risk_alert_outbox
  add column if not exists claimed_at timestamptz;

comment on column public.risk_alert_outbox.claimed_at is
  'Início do lease de envio. NULL = livre. Definido na reivindicação (um ciclo por vez envia) e limpo ao concluir (SENT/FAILED/SKIPPED).';
