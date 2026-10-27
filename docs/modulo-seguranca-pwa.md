# Módulo de campo SSMA (PWA) — decisões, estado e limites

> **Status: primeira versão implementada LOCALMENTE e testada em computador (Chrome headless, PostgreSQL
> descartável). NADA foi publicado nem aplicado em banco real. NÃO foi validado em iPhone nem Android
> reais.** A migration `20261028130000_ssma_field_records.sql` está preparada e **não aplicada**.

## Decisões (inalteradas)

1. **PWA distribuído por link e QR Code, sem publicação nas lojas.** Acesso pelo navegador do celular;
   o usuário pode "instalar" na tela inicial.
2. **QR Code com endereço permanente, sem credenciais.** Contém somente a URL (validada: https — http só em
   localhost —, sem usuário/senha, sem query, sem fragmento). Quem escaneia ainda precisa entrar.
3. **Login e permissões por obra.** Mesma identidade e RBAC do ACC; o isolamento entre obras é imposto no
   banco (RLS/RPCs), não só na interface.
4. **Offline: só o que foi testado é afirmado** (ver "Operação sem sinal").

## O que existe

| Parte | Onde |
|---|---|
| Seletor de obras autorizadas | `app/ssma/page.tsx` |
| App de campo (checklists existentes + registros) | `app/ssma/[projectId]/page.tsx`, `components/ssma/ssma-field-app.tsx` |
| Registro de ocorrência/inspeção (categoria, descrição, local, data, risco, responsável, prazo, fotos) | `components/ssma/field-records/new-record-form.tsx` |
| Lista, detalhe, andamento e conclusão com evidência | `field-records-app.tsx`, `record-detail.tsx` |
| Fila offline (módulo puro) | `lib/ssma/field-records/queue-core.ts` |
| Adaptador IndexedDB / transporte Supabase / hook | `idb-store.ts`, `supabase-transport.ts`, `use-field-queue.ts` |
| Casca offline sem dados | `app/ssma/offline/page.tsx`, `components/ssma/ssma-offline-shell.tsx` |
| Service worker | `public/sw.js` |
| Instalação (link + QR + instruções iOS/Android) | `components/ssma/ssma-install-card.tsx`, `lib/ssma/pwa-install.ts` |
| Painel no ACC | `app/[projectId]/ssma-registros/page.tsx` (link na tela ESG/SSMA) |
| Fotos no painel (URL assinada, só leitura) | `app/api/ssma/records/photos/[photoId]/route.ts` |
| Banco | `supabase/migrations/20261028130000_ssma_field_records.sql` |

Os formulários/checklists SSMA anteriores (`ssma_form_submissions`) **não foram alterados**; continuam
exigindo conexão para enviar.

## Configuração

- `ACC_SSMA_PWA_URL` — URL pública do app de campo (ex.: `https://<dominio-do-acc>/ssma`). Se ausente, usa
  `AXION_APP_BASE_URL` + `/ssma`. **Sem nenhuma das duas, a tela avisa e não gera QR Code** (o endereço
  definitivo não foi inventado).

## Operação sem sinal — o que foi e o que NÃO foi testado

Estados mostrados ao usuário: **Salvo no aparelho** → **Aguardando envio** → **Sincronizado** (e **Falha no
envio**, com motivo, nova tentativa e descarte).

Testado (`npm run test:ssma`):
- lógica da fila (18 casos, módulo puro): gravação sem rede, reconexão, duplicidade, queda no meio do envio
  (retoma sem reenviar), falha do servidor, erro permanente, troca de conta, isolamento por usuário e obra,
  execuções simultâneas, falta de espaço, arquivo local ausente;
- IndexedDB **real** e corte de rede **real** em Chrome (persistência entre recarregamentos, fotos, isolamento,
  envio na reconexão, sem duplicar);
- service worker real em Chrome: guarda só a casca e estáticos; nunca páginas com dados nem API; sem rede,
  navegação para `/ssma/...` recebe a casca;
- migration em PostgreSQL 17 descartável (20 casos): idempotência por id, autoria = `auth.uid()`,
  `USER_MISMATCH` na troca de conta, RLS por obra, perfis (LEITURA não registra), upload no Storage, andamento
  e conclusão com evidência.

**Não testado / limitações:**
- **Nenhum aparelho real** (iPhone/Safari, Android/Chrome). Comportamento do IndexedDB, câmera, instalação e
  service worker em celulares reais pode diferir.
- iOS/Safari pode **apagar dados de sites** não usados por semanas e limita o armazenamento; o app pede
  armazenamento persistente (`navigator.storage.persist()`), mas isso não é garantia. Registros importantes
  devem ser sincronizados assim que houver sinal.
- A casca offline real do Next (hidratação e chunks) **não foi aberta sem rede com o app autenticado**; só o
  mecanismo do service worker foi provado com servidor falso. Para abrir sem sinal é preciso ter aberto o app
  de campo **uma vez com internet** depois da instalação (a casca e o contexto da obra são guardados então).
- **Andamento e conclusão de ações corretivas exigem conexão** (não entram na fila offline nesta versão).
- A lista de registros da obra (servidor) não é guardada no aparelho: sem sinal só aparecem os registros do
  próprio aparelho.
- Fotos: JPG/PNG até 15 MB, máximo 20 por registro; não há compressão. HEIC não é aceito.
- Erro de rede é detectado pela mensagem do cliente Supabase; mensagens diferentes poderiam ser tratadas como
  falha (visível, com nova tentativa) em vez de "sem conexão".

## Autoria, horário e troca de conta

- O id do registro e de cada foto nasce no aparelho (UUID); o servidor é idempotente por id.
- `client_created_at` guarda o horário real no aparelho; `received_at` é o do servidor — nunca um sobrescreve o
  outro. A autoria no servidor é `auth.uid()`, e o aparelho declara o usuário esperado (`p_claimed_user_id`):
  sessão diferente ⇒ `USER_MISMATCH`, nada é gravado.
- A fila é filtrada por usuário: outra conta no mesmo aparelho **não lista nem envia** os registros pendentes de
  quem criou (só vê a contagem). Sair da conta **não apaga** registros ainda não enviados; remover dados de
  outras contas é uma ação explícita e confirmada. Sair apaga o contexto guardado (obra e nomes dos membros).
- O que fica no aparelho: fila de registros e fotos pendentes; contexto mínimo por usuário (nome da obra,
  id/nome dos membros ativos, se o usuário é gestor). **Nunca** tokens, senhas ou dados de outras obras.

## Consulta ao especialista de SSMA

O detalhe do registro (`record-detail.tsx`) traz a caixa "Consultar IA — especialista de SSMA"
(`record-consult.tsx` → `app/ssma/consult-actions.ts` → `lib/ssma/field-records/run-record-consult.ts` →
`lib/ai/alert-consult/ssma-consult.ts`). Regras: exige conexão e vínculo ativo com a obra; o registro é lido
com a sessão do usuário (RLS), então registro de outra obra é recusado; o contexto enviado traz só os fatos
registrados (categoria, descrição, local, data, risco relatado, responsável, estado da ação e contagem de
evidências); somente leitura (não altera o registro nem a ação e não declara conclusão); a resposta indica
quando vem de provedor simulado. Testes: `scripts/test-ssma-record-consult.mjs` (provedor simulado, sem rede).

## O que depende de internet × o que funciona sem sinal

Só o que está implementado **e** testado (Chrome com IndexedDB e service worker reais, `npm run test:ssma`).
**Não** foi validado em iPhone/Safari nem em Android real.

| Função | Sem sinal | Exige internet |
|---|---|---|
| Registrar ocorrência/inspeção (campos completos) | Sim — "Salvo no aparelho" | — |
| Anexar fotos JPG/PNG ao registro | Sim — ficam no aparelho | — |
| Enviar registro e fotos | — | Sim (automático ao voltar o sinal, ou "Enviar agora"); sem duplicar |
| Ver estado dos registros do aparelho (Salvo / Aguardando / Sincronizado / Falha) | Sim | — |
| Lista de registros já enviados da obra e fotos | **Não** (não fica guardada no aparelho) | Sim |
| Registrar andamento / concluir ação corretiva (com evidência) | **Não** | Sim |
| Consultar IA (especialista de SSMA) | **Não** | Sim |
| Entrar, trocar de conta ou de obra | **Não** | Sim |
| Abrir o app sem sinal | Só se já foi aberto uma vez com internet (casca estática + contexto mínimo da obra no aparelho) | — |
| Instalar na tela inicial | — | Sim (abrir o link/QR) |

Limitações atuais de fotos: JPG ou PNG, até 15 MB cada, no máximo 20 por registro, **sem compressão**; **HEIC não é aceito**
(formato padrão do iPhone: configurar a câmera para "Mais compatível" ou converter). O Safari/iOS pode apagar dados de sites
sem uso por semanas; o app pede armazenamento persistente, mas isso não é garantia. Os textos das telas de instalação e de
sincronização exibem este mesmo resumo (`components/ssma/ssma-offline-capabilities.tsx`).

## Restrições herdadas

- Nenhum segredo no frontend; integrações reais só server-side.
- Evidências originais preservadas; o histórico das ações corretivas é imutável (somente inclusão).
- Registros criados offline mantêm autoria e horário reais.

## Em aberto

- Escopo funcional adicional (DDS, quase-acidente com fluxo próprio, integração com o fluxo de acidente).
- Política de retenção de fotos no aparelho e compressão de imagens.
- Estratégia de versionamento/atualização do service worker em produção (hoje: `VERSION` em `public/sw.js`).
- Identificação do dispositivo e política para aparelhos compartilhados em obra (hoje: isolamento por conta).
- Fila offline para andamento/conclusão de ações; cache de leitura dos registros da obra.
