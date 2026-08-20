import "server-only";

import { google } from "googleapis";

export interface GmailInboundConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  mailbox: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required Gmail inbound environment variable: ${name}`);
  }

  return value;
}

export function loadGmailInboundConfig(): GmailInboundConfig {
  return {
    clientId: requiredEnv("GOOGLE_GMAIL_INBOUND_CLIENT_ID"),
    clientSecret: requiredEnv("GOOGLE_GMAIL_INBOUND_CLIENT_SECRET"),
    refreshToken: requiredEnv("GOOGLE_GMAIL_INBOUND_REFRESH_TOKEN"),
    mailbox: requiredEnv("GOOGLE_GMAIL_INBOUND_MAILBOX").toLowerCase(),
  };
}

export function createGmailInboundClient() {
  const config = loadGmailInboundConfig();

  const auth = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret
  );

  auth.setCredentials({
    refresh_token: config.refreshToken,
  });

  return {
    gmail: google.gmail({
      version: "v1",
      auth,
    }),
    config,
  };
}
