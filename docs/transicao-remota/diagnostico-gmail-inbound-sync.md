# Diagnóstico — falha do workflow "Gmail Inbound Sync" (27/10/2026)

## Fatos (logs do GitHub Actions, só leitura)

- Última execução com sucesso: 14/10/2026. **Desde 15/10, todas as execuções falham** (77 falhas nas últimas 100).
- O job `sync` tem duas etapas relevantes: **"Sync Gmail" termina com sucesso** (a sincronização de e-mails funciona) e
  **"Ingest email attachments and meeting minutes" falha** (worker de anexos e atas, `scripts/gmail-ata-ingestion-worker.mjs`).
- Mensagem idêntica em todas as execuções examinadas (26/10 05:05 e 27/10 00:51):
  `[gmail-ata-worker] falha: Requested entity was not found.` e resumo
  `{"scanned":33,"attachmentsSeen":137,"attachmentsIngested":0,"atasPromoted":2,"failures":1}`.
- "Requested entity was not found." é a resposta HTTP **404** da API do Gmail. Nenhum 401/403 (credenciais) aparece.
- Todas essas execuções usaram o commit `ad6a7c3` (anterior ao merge). **Nenhuma execução ocorreu ainda com o código da
  `main` `44571fe`** (o agendador do GitHub atrasa horas).

## Causa

- **Comprovado:** a falha é um 404 numa chamada ao Gmail dentro do worker de anexos/atas; o código antigo tratava qualquer
  erro como falha e encerrava com código 1.
- **Hipótese (não comprovada):** uma mensagem registrada em `emails` deixou de existir no Gmail (apagada ou movida) a
  partir de 15/10, e `messages.get` passou a devolver 404 em todo ciclo. O número fixo de mensagens varridas (33) e de
  falhas (1) em dias diferentes é compatível com um único registro persistente. O dia 15/10 coincide com a reorganização
  de documentos da NEWPORT, mas nenhuma relação foi comprovada.

## O que já está corrigido (na `main`, `7f82687` + `416e7f2`)

`scripts/lib/gmail-ata-processing.mjs` classifica o 404 por operação: `messages.get` 404 vira **aviso**
(`skippedMissingMessage`) e **não** falha o job; `attachments.get` 404 continua falha (processamento incompleto); 401/403/429/5xx
continuam falhas. O log passa a mostrar `recordId=… operation=… httpStatus=404` (sem conteúdo de e-mail).

## Como confirmar

1. Aguardar a próxima execução agendada (ou, com autorização, disparar `workflow_dispatch` uma vez; o worker ingere
   anexos reais, por isso não foi disparado).
2. Esperado: etapa verde com `::warning::` "mensagem ausente no Gmail, ignorada" e `recordId`.
3. Se continuar vermelha, o log trará a operação e o HTTP exatos: `attachments.get` 404 (anexo ausente) ou outra
   operação. Nesse caso investigar o `recordId` indicado (tabela `emails.id`).
4. Se o aviso persistir para um mesmo `recordId`, decidir (com o dono do dado) se o registro deve ser marcado como
   indisponível — alteração de dado de produção, não feita aqui.

## Outros workflows (27/10)

Construmanager Metadata Monitoring, Diário de Obra Sync, Document Processing Worker, MPP Document Worker, SSMA Drive Photo
Sync e Weekly Schedule Email Ingestion: última execução **success**. Não há alerta ativo para falha de worker (pendência).
