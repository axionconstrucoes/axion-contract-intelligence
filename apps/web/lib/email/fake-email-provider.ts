import "server-only";

import { createHash } from "node:crypto";
import { EmailSendError, type EmailProvider, type SendEmailInput, type SendEmailResult } from "./email-provider";

const FAKE_SENDER_ADDRESS = "dev-fake-sender@axion.local";

// Convenção somente de teste: enviar para este endereço força
// EmailSendError, permitindo exercitar o caminho de falha através da
// orquestração completa (via harness HTTP), sem nenhuma opção de config
// exposta em produção. Não tem nenhum efeito no GmailEmailProvider.
export const FAKE_FORCED_FAILURE_RECIPIENT = "smoke-forced-failure@fake.axion.local";

export interface FakeEmailProviderOptions {
  // Permite simular falha de envio em testes diretos, sem depender de rede.
  shouldFail?: (input: SendEmailInput) => boolean;
}

// Nunca envia rede. IDs sintéticos derivados deterministicamente de
// correlationId (nunca Math.random) para manter os testes reprodutíveis.
export class FakeEmailProvider implements EmailProvider {
  private readonly shouldFail?: (input: SendEmailInput) => boolean;

  constructor(options: FakeEmailProviderOptions = {}) {
    this.shouldFail = options.shouldFail;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (input.to === FAKE_FORCED_FAILURE_RECIPIENT || this.shouldFail?.(input)) {
      throw new EmailSendError("FakeEmailProvider: falha simulada.");
    }

    const digest = createHash("sha256").update(input.correlationId).digest("hex");

    return {
      provider: "FAKE",
      from: FAKE_SENDER_ADDRESS,
      providerMessageId: `fake-message-${digest.slice(0, 16)}`,
      providerThreadId: `fake-thread-${digest.slice(16, 32)}`,
      messageIdHeader: `<fake-${digest.slice(0, 24)}@fake.axion.local>`,
      sentAt: new Date().toISOString(),
    };
  }
}
