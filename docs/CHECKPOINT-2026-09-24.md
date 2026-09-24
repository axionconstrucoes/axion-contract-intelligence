# Checkpoint — 24/09/2026

Ponto de retomada para outro PC.

## Últimas alterações

- PR #107 mergeado: resumo determinístico do MPP no Diretor de Planejamento.
- PR #108 mergeado: Gmail passa a marcar a integração como `CONECTADO` após sincronização incremental concluída.
- PRs antigos obsoletos fechados.
- PRs antigos abertos ao final da limpeza: nenhum.

## Piloto WEG

Projeto:

```text
[DEV] WEG - Fábrica de Fios - Linhares
00000000-0000-4000-8000-000000000001
```

Estado verificado:

- 5 usuários ativos.
- 7 documentos.
- 0 documentos com falha de processamento.
- 11 eventos.
- Alertas: 6 enviados / 6 respondidos / 0 falhas.
- Construmanager: CONECTADO.
- Diário de Obra: CONECTADO.
- Gmail: funcional; correção de status visual mergeada no PR #108.
- ESG/SSMA: PENDENTE e ainda precisa ser classificado como dentro ou fora do escopo do piloto.
- Configuração semanal: `enabled=false`; ainda precisa decisão explícita antes do piloto.

## Próximo trabalho

1. Atualizar `main` no novo PC.
2. Confirmar deploy de produção do último merge.
3. Verificar se Gmail aparece como `CONECTADO` após a próxima sincronização.
4. Decidir se a rotina semanal deve ficar habilitada no piloto.
5. Decidir se ESG/SSMA faz parte do piloto.
6. Fazer smoke test final de produção.
7. Congelar `main` como versão piloto.
