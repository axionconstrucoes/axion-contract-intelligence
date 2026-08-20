import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { google } from "googleapis";

const CLIENT_ID =
  process.env.GOOGLE_GMAIL_INBOUND_CLIENT_ID;

const CLIENT_SECRET =
  process.env.GOOGLE_GMAIL_INBOUND_CLIENT_SECRET;

const SENDER =
  process.env.GOOGLE_GMAIL_INBOUND_MAILBOX ??
  "reynaldo@axion.com.br";

const REDIRECT_URI =
  "http://localhost:53683/oauth2callback";

const ENV_PATH =
  path.resolve("apps/web/.env.local");

if (!CLIENT_ID || !CLIENT_SECRET || !SENDER) {
  console.error("ERRO: credenciais base Gmail ausentes.");
  process.exit(1);
}

const oauth2Client =
  new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
  );

const state = crypto.randomUUID();

const authorizationUrl =
  oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: false,
    login_hint: SENDER,
    scope: [
      "https://www.googleapis.com/auth/gmail.send",
    ],
    state,
  });

function setEnvValue(key, value) {
  let content =
    fs.existsSync(ENV_PATH)
      ? fs.readFileSync(ENV_PATH, "utf8")
      : "";

  content =
    content.replace(/^\uFEFF/, "");

  const line = `${key}=${value}`;
  const regex =
    new RegExp(`^${key}=.*$`, "m");

  if (regex.test(content)) {
    content =
      content.replace(regex, line);
  } else {
    if (
      content.length > 0 &&
      !content.endsWith("\n")
    ) {
      content += "\n";
    }

    content += `${line}\n`;
  }

  fs.writeFileSync(
    ENV_PATH,
    content,
    { encoding: "utf8" }
  );
}

const server =
  http.createServer(
    async (req, res) => {
      try {
        const requestUrl =
          new URL(
            req.url ?? "/",
            REDIRECT_URI
          );

        const code =
          requestUrl.searchParams.get("code");

        const returnedState =
          requestUrl.searchParams.get("state");

        const oauthError =
          requestUrl.searchParams.get("error");

        if (oauthError) {
          throw new Error(
            `Google OAuth error: ${oauthError}`
          );
        }

        if (
          !code ||
          returnedState !== state
        ) {
          throw new Error(
            "Callback OAuth inválido."
          );
        }

        const { tokens } =
          await oauth2Client.getToken(code);

        if (!tokens.refresh_token) {
          throw new Error(
            "Google não retornou refresh token."
          );
        }

        setEnvValue(
          "GOOGLE_GMAIL_CLIENT_ID",
          CLIENT_ID
        );

        setEnvValue(
          "GOOGLE_GMAIL_CLIENT_SECRET",
          CLIENT_SECRET
        );

        setEnvValue(
          "GOOGLE_GMAIL_REFRESH_TOKEN",
          tokens.refresh_token
        );

        setEnvValue(
          "GOOGLE_GMAIL_SENDER_EMAIL",
          SENDER.toLowerCase()
        );

        setEnvValue(
          "AXION_EMAIL_PROVIDER",
          "gmail"
        );

        res.writeHead(
          200,
          {
            "Content-Type":
              "text/html; charset=utf-8",
          }
        );

        res.end(`
          <h2>AXION Gmail Outbound autorizado</h2>
          <p>Sender: ${SENDER}</p>
          <p>Escopo: gmail.send</p>
          <p>Você pode fechar esta janela.</p>
        `);

        console.log("");
        console.log(
          "OK - Gmail outbound restaurado."
        );
        console.log(
          "Sender:",
          SENDER
        );
        console.log(
          "Escopo: gmail.send"
        );
        console.log(
          "Refresh token salvo sem ser exibido."
        );

        setTimeout(
          () => server.close(),
          1000
        );
      } catch (error) {
        console.error(
          "ERRO OAuth:",
          error instanceof Error
            ? error.message
            : "erro desconhecido"
        );

        res.writeHead(500);
        res.end(
          "Falha na autorização Gmail outbound."
        );

        setTimeout(
          () => server.close(),
          1000
        );
      }
    }
  );

server.listen(
  53683,
  "127.0.0.1",
  () => {
    console.log("");
    console.log(
      "Abrindo autorização Gmail outbound..."
    );

    console.log(authorizationUrl);

    exec(
      `start "" "${authorizationUrl}"`
    );
  }
);
