// Puro, sem I/O — deliberadamente sem "server-only" (mesmo padrão de
// templates/contract-alert-template.ts) para ser testável tanto pelo
// bundler do Next.js quanto por scripts Node standalone (prévia e
// testes). Não contém nenhum segredo/config — só uma checagem de string.
//
// Marcador ÚNICO, presente SÓ no nome de projeto fictício usado pela
// prévia de teste (scripts/generate-alert-email-preview.mjs — exemplo
// "DUX") — nunca um nome de obra/projeto real legítimo colidiria com
// esta string exata (travessão específico + caixa alta), então checar
// só a presença dela não gera falso positivo contra projetos reais.
// Esta é a MESMA string que aparece no corpo do e-mail de prévia como
// identificação "PROJETO FICTÍCIO — NÃO CONTRATADO" exigida pelo
// requisito — reaproveitada aqui como marcador de bloqueio, nunca uma
// segunda string divergente.
export const EMAIL_FIXTURE_PROJECT_NAME_MARKER = "PROJETO FICTÍCIO — NÃO CONTRATADO";

export class FixtureDataInProductionSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixtureDataInProductionSendError";
  }
}

// Chamado por sendContractAlertEmail() ANTES de montar/enviar qualquer
// e-mail real — última barreira de código contra a fixture de prévia
// (DUX) alcançar o provider real, mesmo que algum caller futuro
// acidentalmente encaminhe dados de uma prévia para o fluxo de envio
// verdadeiro. Nunca chamado a partir do próprio gerador de prévia (que
// nunca invoca sendContractAlertEmail / o provider real).
export function assertNotEmailFixtureData(projectName: string): void {
  if (projectName.includes(EMAIL_FIXTURE_PROJECT_NAME_MARKER)) {
    throw new FixtureDataInProductionSendError(
      `Envio bloqueado: o nome do projeto ("${projectName}") contém o marcador de dado fictício de prévia de teste e nunca pode ser enviado pelo provedor real de e-mail.`
    );
  }
}
