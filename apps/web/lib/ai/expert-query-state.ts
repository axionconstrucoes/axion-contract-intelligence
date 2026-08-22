// Estado inicial e tipos da consulta conversacional "Perguntar ao
// Diretor Comercial IA" — deliberadamente FORA de qualquer módulo
// "use server".
//
// Next.js só permite que um arquivo "use server" exporte funções async
// (Server Actions) — um objeto/const exportado dali (mesmo um estado
// inicial trivial como este) quebra em runtime com "A 'use server' file
// can only export async functions, found object.", especialmente
// quando esse export é importado por um Client Component (como
// components/ai/expert-query-panel.tsx). Este módulo é o local
// server/client-neutro para o tipo e o valor inicial compartilhados
// entre o Server Action (expert-query-action.ts) e o Client Component
// que o consome.

import type { AiProviderUiMetadata } from "./provider-ui-metadata";
import type { ExpertQueryResponse } from "./query/types";

export type AskExpertQueryMeta = AiProviderUiMetadata;

export type AskCommercialDirectorState = {
  response: ExpertQueryResponse | null;
  error: string | null;
  /**
   * Provider/modelo real usado nesta resposta — exibido na UI para nunca
   * confundir fake com IA real. `undefined` é tolerado no tipo (além de
   * `null`) porque o estado inicial passado a `useActionState` é uma prop
   * pública de `ExpertQueryPanel` (`initialState`) — nada garante, no
   * nível de tipos do React, que todo chamador futuro preencha `meta`
   * explicitamente. O componente sempre normaliza para `null` antes de
   * qualquer acesso (nunca usa non-null assertion) — ver
   * `normalizeProviderMeta` em `provider-ui-metadata.ts`.
   */
  meta: AskExpertQueryMeta | null | undefined;
};

export const initialAskCommercialDirectorState: AskCommercialDirectorState = {
  response: null,
  error: null,
  meta: null,
};
