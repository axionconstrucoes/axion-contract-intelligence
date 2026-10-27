# Redesign da interface do ACC — especificação (v2, tema escuro)

Base: `origin/main` em `e11fe7c`. Conceito em canvas com cinco pranchas:
Seleção de projeto, Dashboard, Timeline, Detalhe do evento, Sistema visual.
Este documento substitui a versão anterior (lateral grafite, fundo claro).

## 1. Princípio

Tema **escuro sem peso**: nada de fundo branco e nada de preto puro. A área
de trabalho é cinza-azulado, os cartões são um degrau mais claros, e a marca
fica na **lateral vermelha AXION com grade**. Texto grande, legível.

## 2. Paleta

| Papel | Hex |
| --- | --- |
| Vermelho AXION (lateral, marca) | `#7F1D1D` — já é `--brand-sidebar`; não criar outro vermelho institucional |
| Creme (item ativo, ação primária) | `#F7F3EA`, texto sobre creme `#5E1414` |
| Fundo de trabalho | `#1B2027` |
| Cartão | `#242A33` |
| Barra superior | `#2F3641` |
| Faixa de indicadores | `#262C35` com grade 48 px a 4% |
| Superfície rebaixada (campos, citação) | `#1F252D` |
| Borda de cartão | `#343C48` · borda de campo `#4A5361` |
| Texto principal / secundário | `#E8EBF0` / `#AEB6C2` (rótulos `#C4CBD6`) |
| Normal (verde) | `#3FBF93` — etiqueta fundo `#1E4A3C`, texto `#8FE0C0` |
| Atenção (âmbar) | `#F2B33D` — fundo `#5A4311`, texto `#F7D488` |
| Alto (laranja) | `#F28C45` — fundo `#5E3114`, texto `#F9BE8C` |
| Crítico (vermelho vivo) | `#FF6B57` — fundo `#5C2219`, texto `#FFA899` |
| Jurídico IA (azul) | `#3D8FE0`, ícone sobre `#1D4F86` |

Regra: dois vermelhos com papéis separados. O institucional nunca significa
risco; o vivo nunca é superfície de marca. Níveis de risco também diferem em
luminosidade, não só em matiz.

Grade da lateral: `linear-gradient(rgba(255,255,255,.07) 1px, transparent 1px)`
nos dois eixos, `background-size: 48px 48px`, sobre `--brand-sidebar`.

## 3. Tipografia (IBM Plex Sans + IBM Plex Mono)

| Papel | Tamanho / peso |
| --- | --- |
| Número de indicador | Mono 52 / 600 |
| Título de tela | 30 / 600 (barra superior 20 / 600) |
| Título de cartão | 18 / 600 |
| Corpo | 16–17, linha 1,6, máx. 72ch |
| Rótulo de indicador | 14 / 600, caixa alta, `letter-spacing .1em` |
| Etiqueta | 13 / 600, `letter-spacing .06em` |

Data, valor, percentual e código sempre em mono. Nenhum texto abaixo de 13 px.

## 4. Medidas

Espaços 4, 8, 16, 24, 32. Raios: 3 etiqueta, 5 botão, 7 cartão. Sem sombras;
separação por borda de 1 px. Alvo de toque mínimo 44 px. Lateral 264 px, barra
superior 72 px.

## 5. Telas

- **Seleção de projeto:** fundo vermelho com grade; painel cinza escuro
  grande (até 1280 px, padding 56, altura mínima 640); cartões de projeto em
  `#1F252D` com faixa de risco no topo, avanço físico, alertas e contrato;
  cartão **Jurídico IA — Analista jurídico** com faixa azul e botão "Abrir";
  nota sobre acesso ao pé.
- **Dashboard:** faixa de quatro indicadores (alertas ativos, ações vencidas,
  risco atual, avanço físico) com borda esquerda na cor do nível; depois
  curva S (hachura no vão entre previsto e realizado, cota "5,6 p.p. atrás") e
  situação financeira; por último avisos operacionais e fontes conectadas.
  Avisos operacionais ficam separados dos alertas contratuais.
- **Timeline:** busca sempre visível (56 px, com contagem); filtros avançados
  em painel que abre e fecha, com contador (origem, categoria, período,
  participantes); lista agrupada por dia, faixa de 4 px na cor do nível.
- **Detalhe do evento:** duas colunas. Esquerda: resumo, avaliação da IA
  separando **fato / inferência / recomendação** com fonte, e bloco
  "Enviar alerta contratual" (borda superior vermelha AXION, grade 40 px).
  Direita: evidência original "não editável", confronto com outras fontes,
  histórico.

## 6. Ordem de implementação

1. `apps/web/app/globals.css` — tokens de superfície, texto e risco, sem
   redefinir `--brand-sidebar` e `--brand-header`.
2. `components/layout/app-sidebar.tsx` — vermelho + grade, item ativo creme,
   logo da marca (arquivo do logo enviado pelo usuário).
3. `components/layout/top-bar.tsx`.
4. Seleção de projeto → Dashboard → Timeline → Detalhe do evento, uma por vez.

Antes de começar: ler `apps/web/node_modules/next/dist/docs/` (AGENTS.md avisa
de mudanças no Next 16) e o `CLAUDE.md`.

## 7. Restrições

- Mudança **visual apenas**: sem alterar rota, loader, action, permissão, RLS
  ou regra de negócio. Não inventar indicador, regra ou funcionalidade.
- `--brand-sidebar` e `--brand-header` são valor fixo; o tema escuro não os
  redefine.
- Após cada etapa: `npm run lint`, `npm run build` e os scripts de teste da
  área tocada.
- `git push` só com autorização explícita.

## 8. Estado da suíte em `e11fe7c`

Nove testes vermelhos pré-existentes, sem relação com UI:
`test-expert-capabilities` (3), `test-provider-per-expert` (1) e
`test-experts-ia-hub` (5). Com a suíte já vermelha, uma regressão nova passa
despercebida; convém anotar a contagem antes de começar.
