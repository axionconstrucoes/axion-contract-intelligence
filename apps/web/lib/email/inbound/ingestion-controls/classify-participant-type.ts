// Sugestão inicial de classificação de participante monitorado (seção
// 4 do requisito): @axion.com.br => AXION; domínio configurado como
// cliente => CLIENTE; qualquer outro externo => TERCEIRO sugerido
// (nunca classificado automaticamente como CLIENTE). Sempre corrigível
// por humano — esta função só decide o valor PADRÃO inicial.

export type ParticipantType = "AXION" | "CLIENTE" | "TERCEIRO";

export function classifyParticipantType(email: string, axionDomain: string, clientDomains: string[]): ParticipantType {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (domain === axionDomain.toLowerCase()) return "AXION";
  if (clientDomains.some((clientDomain) => clientDomain.toLowerCase() === domain)) return "CLIENTE";
  return "TERCEIRO";
}
