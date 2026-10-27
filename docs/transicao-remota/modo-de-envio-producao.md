# Modo de envio de e-mail em produção — como confirmar (sem enviar nada)

> Estado em 27/10/2026: **não confirmado**. A leitura descriptografada de `ACC_OUTBOUND_MODE` pela ferramenta da Vercel
> foi negada, e nenhum meio público ou de log revela o valor. Não se deve enviar e-mail para descobrir. Este documento
> diz onde olhar.

## Regra do código (`apps/web/lib/email/pilot-outbound-guard.ts`)

- O envio é **real** somente quando `ACC_OUTBOUND_MODE` vale **exatamente** `production` **e** a data (São Paulo) é a de
  go-live (22/09/2026) ou posterior. **A data de go-live já passou**: hoje a variável é a única trava.
- Qualquer outro valor, vazio ou ausente = **modo piloto**: todo destinatário é redirecionado para
  `crm@axion.com.br` (única exceção: endereços `@axion.com.br` listados em `ACC_PILOT_ADDITIONAL_RECIPIENTS`, variável
  que **não existe** na Vercel de produção) e o assunto recebe o prefixo `[TESTE CONTROLADO] `.
- `ACC_PILOT_RECIPIENT` em produção deve apontar para `crm@axion.com.br`; se divergir, o envio é bloqueado.

## O que conferir (a pessoa autorizada, 2 minutos)

1. **Vercel** → projeto `axion-contract-intelligence-5d3g` → *Settings* → *Environment Variables* → filtre
   `ACC_OUTBOUND_MODE` → linha com ambiente **Production** → botão de revelar o valor.
   - Valor **diferente** de `production` (ou ausente) → **piloto ativo**.
   - Valor exatamente `production` → **envio real ativo**. Se isso não for desejado, troque o valor (por exemplo,
     `pilot`) e faça *Redeploy* — essa alteração é de configuração e deve ser decidida por quem administra a Vercel.
2. Confira também `ACC_PILOT_RECIPIENT` (Production) = `crm@axion.com.br`.
3. **Confirmação pela própria tela (sem enviar):** logado como administrador, abra o detalhe de um evento em
   `/{obra}/ledger/{evento}`. Em modo piloto o formulário de envio manual mostra o aviso
   *"Modo piloto ativo: qualquer envio manual é redirecionado para a caixa de teste (c***@axion.com.br) — o colaborador
   selecionado não receberá a mensagem."* Se **não** houver esse aviso, o modo está em produção.

## Evidência indireta já coletada (não prova o modo)

Em `contract_alert_batches`, das 15 remessas já enviadas (23/09, 24/09 e 10/10/2026), 14 foram para `crm@axion.com.br`
e 1 para outro endereço `@axion.com.br` (23/09). Em todas, destino pretendido = efetivo. Isso é compatível com piloto
(lotes endereçados à caixa institucional) e **não** distingue piloto de produção. Tabelas vazias após o deploy também não
provam o modo.

## Enquanto não estiver confirmado

- Não criar alertas reais nem disparar manualmente `Alert Reminders` ou `Contract Alert Batches`.
- O agendamento `Alert Reminders` (a cada 30 min) só envia lembretes de alertas que existam nas tabelas novas
  (`alert_followups`, `project_delivery_items`), hoje vazias; ele respeita a mesma regra de saída.
