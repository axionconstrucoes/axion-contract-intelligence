import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { google } from "googleapis";

// --prefix=ACC_RISK_ALERTS_INBOUND gera o refresh token da caixa DEDICADA
// das respostas aos alertas de risco (axion@…) lendo/gravando
// <PREFIXO>_CLIENT_ID/_CLIENT_SECRET/_MAILBOX/_REFRESH_TOKEN — sem tocar nas
// variáveis GOOGLE_GMAIL_INBOUND_* do Gmail Inbound Sync. Default: prefixo
// legado GOOGLE_GMAIL_INBOUND. Escopo continua gmail.readonly.
const PREFIX = (process.argv.find((arg) => arg.startsWith("--prefix=")) ?? "--prefix=GOOGLE_GMAIL_INBOUND").split("=")[1].replace(/[^A-Z0-9_]/g, "");
const CLIENT_ID = process.env[`${PREFIX}_CLIENT_ID`];
const CLIENT_SECRET = process.env[`${PREFIX}_CLIENT_SECRET`];
const MAILBOX = process.env[`${PREFIX}_MAILBOX`];

const REDIRECT_URI = "http://localhost:53682/oauth2callback";
const ENV_PATH = path.resolve("apps/web/.env.local");

if (!CLIENT_ID || !CLIENT_SECRET || !MAILBOX) {
  console.error(
    `ERRO: configure ${PREFIX}_CLIENT_ID, ` +
    `${PREFIX}_CLIENT_SECRET e ${PREFIX}_MAILBOX.`
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const state = crypto.randomUUID();

const authorizationUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  include_granted_scopes: false,
  login_hint: MAILBOX,
  scope: [
    "https://www.googleapis.com/auth/gmail.readonly",
  ],
  state,
});

function setEnvValue(key, value) {
  let content = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, "utf8")
    : "";

  const line = `${key}=${value}`;
  const regex = new RegExp(`^${key}=.*$`, "m");

  if (regex.test(content)) {
    content = content.replace(regex, line);
  } else {
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }

    content += `${line}\n`;
  }

  fs.writeFileSync(ENV_PATH, content, "utf8");
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(
      req.url ?? "/",
      REDIRECT_URI
    );

    if (requestUrl.pathname !== "/oauth2callback") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const returnedState = requestUrl.searchParams.get("state");
    const code = requestUrl.searchParams.get("code");
    const oauthError = requestUrl.searchParams.get("error");

    if (oauthError) {
      throw new Error(`Google OAuth error: ${oauthError}`);
    }

    if (!code || returnedState !== state) {
      throw new Error("Invalid OAuth callback.");
    }

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      throw new Error(
        "Google did not return a refresh token."
      );
    }

    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({
      version: "v1",
      auth: oauth2Client,
    });

    const profile = await gmail.users.getProfile({
      userId: "me",
    });

    const authenticatedMailbox =
      profile.data.emailAddress?.toLowerCase();

    if (authenticatedMailbox !== MAILBOX.toLowerCase()) {
      throw new Error(
        `Mailbox mismatch. Expected ${MAILBOX}, got ${authenticatedMailbox}.`
      );
    }

    setEnvValue(
      `${PREFIX}_REFRESH_TOKEN`,
      tokens.refresh_token
    );

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
    });

    res.end(`
      <h2>AXION Gmail Inbound autorizado</h2>
      <p>Mailbox: ${authenticatedMailbox}</p>
      <p>Refresh token salvo localmente em apps/web/.env.local.</p>
      <p>Você pode fechar esta janela.</p>
    `);

    console.log("");
    console.log("OK - Gmail inbound autorizado.");
    console.log("Mailbox:", authenticatedMailbox);
    console.log(
      "Refresh token salvo em apps/web/.env.local."
    );
    console.log(
      "O token completo NÃO foi exibido no terminal."
    );

    setTimeout(() => {
      server.close();
    }, 1000);
  } catch (error) {
    console.error(
      "ERRO OAuth:",
      error instanceof Error ? error.message : "unknown error"
    );

    res.writeHead(500, {
      "Content-Type": "text/plain; charset=utf-8",
    });

    res.end("Falha na autorização Gmail inbound.");

    setTimeout(() => {
      server.close();
    }, 1000);
  }
});

server.listen(53682, "127.0.0.1", () => {
  console.log("");
  console.log("Abrindo autorização Google...");
  console.log("");
  console.log(authorizationUrl);
  console.log("");

  exec(`start "" "${authorizationUrl}"`);
});
