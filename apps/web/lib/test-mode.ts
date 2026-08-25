// Etiqueta global "SISTEMA EM TESTE" — regra fail-safe (seção 3 do
// requisito): só se esconde com o valor EXATO "false". Ausente, vazio,
// "true" ou qualquer outro valor inválido sempre mostra a etiqueta —
// nunca o contrário, para nunca esconder o aviso por engano.
//
// Sem desligamento automático por data/relógio (seção 5): a remoção é
// sempre manual, por configuração + novo deploy.
export function isTestModeBannerVisible(
  rawValue: string | undefined = process.env.NEXT_PUBLIC_ACC_TEST_MODE
): boolean {
  return rawValue !== "false";
}

export const ACC_TEST_MODE_BANNER_TEXT = "SISTEMA EM TESTE";
