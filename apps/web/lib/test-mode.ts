import { hasAccGoLiveOccurred } from "@/lib/acc-go-live";

// Etiqueta global "SISTEMA EM TESTE" — regra fail-safe (seção 3 do
// requisito original): ANTES do marco oficial de startup/go-live (ver
// lib/acc-go-live.ts), só se esconde com o valor EXATO "false". Ausente,
// vazio, "true" ou qualquer outro valor inválido sempre mostra a
// etiqueta antes do marco — nunca o contrário, para nunca esconder o
// aviso por engano.
//
// A PARTIR do marco de startup/go-live (07/09/2026 09:00,
// America/Sao_Paulo), a etiqueta deixa de ser exibida automática e
// incondicionalmente, independente do valor de
// NEXT_PUBLIC_ACC_TEST_MODE — o início oficial da operação é uma
// decisão de negócio já tomada, não algo que uma variável de ambiente
// esquecida (ou propositalmente deixada em "true") deveria conseguir
// reverter silenciosamente. A comparação usa o instante absoluto (UTC),
// nunca o relógio/timezone do servidor.
//
// `now` é injetável (default `new Date()`) só para permitir teste
// determinístico dos três instantes do marco (antes/exatamente/depois)
// sem mockar o relógio global.
export function isTestModeBannerVisible(
  rawValue: string | undefined = process.env.NEXT_PUBLIC_ACC_TEST_MODE,
  now: Date = new Date()
): boolean {
  if (hasAccGoLiveOccurred(now)) return false;
  return rawValue !== "false";
}

export const ACC_TEST_MODE_BANNER_TEXT = "SISTEMA EM TESTE";
