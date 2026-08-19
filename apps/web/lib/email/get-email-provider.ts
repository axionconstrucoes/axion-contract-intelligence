import "server-only";

import { FakeEmailProvider } from "./fake-email-provider";
import { GmailEmailProvider } from "./gmail-email-provider";
import { resolveEmailProviderName } from "./gmail-auth";
import type { EmailProvider } from "./email-provider";

// FAIL CLOSED: se AXION_EMAIL_PROVIDER=gmail e a config estiver incompleta,
// GmailEmailProvider lanca no construtor (loadGmailConfig) — nunca cai
// silenciosamente para FakeEmailProvider.
export function getEmailProvider(): EmailProvider {
  const providerName = resolveEmailProviderName();

  if (providerName === "gmail") {
    return new GmailEmailProvider();
  }

  return new FakeEmailProvider();
}
