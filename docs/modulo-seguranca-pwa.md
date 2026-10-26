# Módulo de Segurança (futuro) — decisão registrada

> **Status: decisão documentada. NADA foi implementado.** Este registro existe para que a
> implementação futura não reabra as escolhas já tomadas.

## Decisões

1. **PWA distribuído por link e QR Code, sem publicação nas lojas** (App Store / Google Play).
   O acesso é pelo navegador do celular; o usuário pode "instalar" o PWA na tela inicial.
2. **QR Code com endereço permanente, sem credenciais.** O QR Code aponta para uma URL estável do ACC
   (por obra). Ele **nunca** carrega token, senha, identificador de sessão ou qualquer segredo. Quem
   escaneia ainda precisa autenticar. Trocar o QR Code não deve ser necessário para revogar acesso.
3. **Login e permissões por obra.** Mesma identidade e mesmo RBAC do ACC (papel por projeto); o PWA
   nunca concede acesso a uma obra de que o usuário não participa. Isolamento entre obras continua
   sendo imposto no banco (RLS), não só na interface.
4. **Funcionamento offline é requisito a DETALHAR e TESTAR** (ainda não especificado):
   - o que precisa funcionar sem rede (consulta de checklists? registro de ocorrência? fotos?);
   - fila local de envios e reconciliação ao reconectar (idempotência, conflitos, ordem);
   - o que NÃO pode ficar em cache no aparelho (dados sensíveis, tokens, evidências de outras obras);
   - expiração/revogação de sessão e dados locais ao perder o acesso à obra;
   - testes em aparelhos reais e em redes ruins antes de prometer o recurso.

## Restrições herdadas das regras permanentes do projeto

- Nenhum segredo no frontend/PWA; integrações reais só com configuração server-side.
- Evidências originais preservadas; todo dado derivado mantém rastreabilidade até a fonte.
- Registros criados offline precisam manter autoria e horário reais (não o da sincronização).

## Em aberto (decidir antes de implementar)

- Escopo funcional do módulo (ocorrências, DDS, inspeções, quase-acidentes, fotos).
- Política de retenção de fotos/arquivos no aparelho.
- Estratégia de versionamento do service worker e de atualização do PWA.
- Identificação do dispositivo e política para aparelhos compartilhados em obra.
