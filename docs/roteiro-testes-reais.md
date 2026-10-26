# Roteiro curto de testes reais (e-mails e PWA de campo)

> **Nada deste roteiro foi executado.** Até aqui só houve testes automatizados (serviços simulados) e
> capturas no Chrome. Este documento prepara os testes em clientes e aparelhos REAIS, que dependem de
> decisões e confirmações suas (seção "Antes de qualquer envio"). Não use dados de produção.

## Antes de qualquer envio — o que precisa ser confirmado

| Item | Situação conhecida no código | O que confirmar |
|---|---|---|
| Ambiente | O código não distingue "teste" de "produção" por si; vale o que estiver nas variáveis do deploy. | Qual deploy será usado (preview da Vercel ou local com túnel) e que ele aponta para um banco de TESTE, nunca para o remoto de produção. |
| Modo de saída | `ACC_OUTBOUND_MODE`: só o valor exato `production` libera envio externo; qualquer outro valor (ou ausente) é **modo piloto**. O guard (`applyPilotOutboundGuard`) redireciona TODO destinatário para `crm@axion.com.br` e prefixa o assunto com `[TESTE CONTROLADO]`. | Que o ambiente de teste está em modo piloto (variável **não** é `production`). Não alterar o guard nem a variável para o teste. |
| Destinatário de teste | Em piloto o único destino efetivo é `crm@axion.com.br` (e, se configurado, e-mails corporativos de `ACC_PILOT_ADDITIONAL_RECIPIENTS`, mesmo domínio). | Quem lê essa caixa e em quais clientes (Gmail/Outlook/celular) ela pode ser aberta. Para ver o layout em outro cliente, **encaminhar** a mensagem recebida (ou abrir a caixa nesse cliente); não ampliar a allowlist. |
| Quem dispara | Envio manual (ADMINISTRADOR) ou lote/cron. O cron de lembretes exige `CRON_SECRET` e só vale depois do merge na `main`. | Preferir **envio manual individual** e **um lote criado para um projeto de teste** (obra fictícia com membros de teste). Não ligar o agendamento remoto. |
| Dados | Obra e eventos fictícios; nunca NEWPORT ou documentos reais. | Criar uma obra de teste no banco de TESTE com 2 colaboradores fictícios. |
| URL do PWA | `ACC_SSMA_PWA_URL` (ou `AXION_APP_BASE_URL` + `/ssma`). Sem nenhuma das duas a tela não gera QR. | A URL HTTPS do deploy de teste (PWA/câmera exigem HTTPS; `localhost` só vale no próprio computador). |
| Chaves de IA | Só server-side; consulta de IA é opcional no roteiro. | Se testar a consulta, usar o provedor simulado; **não** habilitar `ACC_ALLOW_LIVE_AI_TESTS`. |

## A. E-mails em Gmail, Outlook e celular

Pré-requisitos: ambiente de teste em modo piloto; obra de teste; destinatário efetivo `crm@axion.com.br`.

1. Gerar os cenários (obra fictícia, destinatário fictício → efetivo `crm@`):
   - um lote de **uma obra com os quatro riscos** (assunto `[RISCO CRÍTICO] OBRA | 4 alertas | ACC`);
   - um lote **só médio/baixo** (assunto `OBRA | 2 alertas | ACC`);
   - uma **segunda obra** para o mesmo destinatário (deve chegar como **outro e-mail**);
   - um **envio manual individual** de cada nível (assuntos `[RISCO CRÍTICO] OBRA | ACC`, `[RISCO ALTO] OBRA | ACC`, `OBRA | ACC`).
   - Em todos o assunto chega com o prefixo `[TESTE CONTROLADO]` (piloto).
2. Conferir em cada cliente — **Gmail web**, **app Gmail (Android/iPhone)**, **Outlook web/desktop**, **app Outlook** e **Mail do iPhone**:
   - cores: crítico vermelho/branco, alto amarelo/preto, médio e baixo brancos; logo invertido só no vermelho;
   - cabeçalho "RISCO [NÍVEL] | [OBRA]" em negrito e título maior, sem cortes; títulos longos quebram;
   - coluna branca dos botões; três botões iguais com texto inteiro (RESOLVIDO / EM ANDAMENTO / ENVIADO P/);
   - **desktop:** CONSULTAR IA acima dos botões; **celular:** ao lado, com área de toque confortável. Se um cliente ignorar o CSS, o layout vertical deve continuar legível — **anotar qual cliente ignora**;
   - o título e as evidências abrem o ACC; CONSULTAR IA abre a página de consulta (exige login e vínculo com a obra);
   - modo escuro do cliente (Gmail/Outlook/iOS): anotar inversões de cor e se o logo some.
3. Confirmar que **abrir** os links (GET) não altera nada; só a confirmação explícita registra a ação.
4. Registrar: cliente, versão, desktop/celular, captura da tela e o que difere do esperado.

Limitações conhecidas: Outlook para Windows (motor do Word) não segue algumas regras de CSS.

## B. Instalar o PWA por QR Code (iPhone e Android)

Pré-requisito: `ACC_SSMA_PWA_URL` apontando para o deploy de teste (HTTPS). Abrir `/ssma` no computador, logado, e exibir o QR da tela de instalação (contém **só a URL**, sem credenciais).

- **iPhone (Safari):** escanear o QR com a Câmera → abrir no **Safari** → Compartilhar → "Adicionar à Tela de Início". Abrir pelo ícone; entrar com a conta de teste.
- **Android (Chrome):** escanear o QR → abrir no **Chrome** → menu ⋮ → "Instalar app" / "Adicionar à tela inicial". Abrir pelo ícone; entrar.
- Conferir: ícone e nome do app, tela cheia, o aviso "O que funciona sem sinal / exige internet", o seletor de obra (só obras do usuário).

## C. Registro e foto sem sinal, sincronização, duplicidade e troca de conta

Para cada aparelho (com a conta de teste A logada e **uma vez** com internet para carregar o app):

1. **Sem sinal:** ligar o modo avião. Criar uma ocorrência com foto (câmera), risco, responsável e prazo. Esperado: estado **"Salvo no aparelho"** → **"Aguardando envio"**; o app continua abrindo.
2. **Reconexão:** desligar o modo avião. Esperado: **"Sincronizado"**. No ACC (`/[projeto]/ssma-registros`) o registro aparece **uma única vez**, com a foto e o **horário real da criação** (não o da sincronização).
3. **Duplicidade:** repetir com sinal oscilando (ligar/desligar durante o envio) e tocar em nova tentativa; fechar e reabrir o app no meio do envio. Esperado: **um** registro.
4. **Falha visível:** usar foto acima de 15 MB ou formato HEIC (iPhone: configurar a câmera para "Mais compatível"/JPG); esperado: mensagem clara e nova tentativa/descarte.
5. **Troca de conta no mesmo aparelho:** deixar um registro "Aguardando envio" da conta A; sair; entrar com a conta B. Esperado: B **não vê nem envia** os registros de A (só a contagem de pendentes); ao voltar para A, o registro segue pendente e é enviado. Testar "Remover registros de outras contas" (ação confirmada).
6. **Obra sem acesso:** com a conta B, tentar abrir uma obra de que não participa → não encontrada.
7. **Funções que exigem internet** (confirmar o bloqueio): login/troca de conta, lista de registros, andamento e conclusão das ações, consulta ao especialista de SSMA.
8. Anotar: sistema/versão, navegador, se o armazenamento local foi limpo pelo sistema (Safari/iOS pode apagar dados de sites sem uso por semanas), e a captura da tela.

## Critério de aprovação (sugestão)
Cada cenário A/B/C aprovado em pelo menos um iPhone e um Android, e em Gmail e Outlook; qualquer divergência vira item registrado antes de qualquer publicação.
