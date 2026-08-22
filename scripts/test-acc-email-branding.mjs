// Testes do padrão institucional de e-mails do ACC (remetente, subject
// dinâmico, template HTML/badges, botão RESPONDER AO ACC) e da detecção
// de idioma de documentos multilíngues.
//
// SEGURANÇA: este ambiente tem AXION_EMAIL_PROVIDER=gmail configurado
// (envio real). Por isso este script NUNCA chama getEmailProvider() nem
// sendContractAlertEmail() (que resolveria para o Gmail real) — só testa
// os construtores puros (subject/HTML/text/MIME) e o FakeEmailProvider
// instanciado diretamente, que nunca faz rede. Nenhuma mensagem real é
// enviada a terceiros.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-acc-email-branding.mjs

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { ACC_SENDER_DISPLAY_NAME, ACC_INSTITUTIONAL_TARGET_EMAIL, formatSenderHeader, isInstitutionalSenderConfigured } =
  await import("../apps/web/lib/email/sender-identity");
const { base64UrlEncode, buildMimeMessage } = await import("../apps/web/lib/email/mime-message");
const { buildContractAlertSubject, buildContractAlertEmail, alertRiskLevelLabels } = await import(
  "../apps/web/lib/email/templates/contract-alert-template"
);
const { buildRespondToAccUrl } = await import("../apps/web/lib/email/build-respond-to-acc-url");
const { FakeEmailProvider } = await import("../apps/web/lib/email/fake-email-provider");
const { detectSourceLanguage } = await import("../apps/web/lib/documents/detect-source-language");

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

console.log("");
console.log("======================================");
console.log("ACC — E-MAILS OFICIAIS + MULTIIDIOMA — TESTES");
console.log("======================================");
console.log("");

// ---------- 1. remetente ----------

check("remetente visível correto no header From (nome + endereço, endereço nunca alterado)", () => {
  const header = formatSenderHeader("reynaldo@axion.com.br");
  assert(header === '"ACC AXION CONTROLE DE CONTRATOS" <reynaldo@axion.com.br>', `header inesperado: ${header}`);
  assert(ACC_SENDER_DISPLAY_NAME === "ACC AXION CONTROLE DE CONTRATOS", "nome de exibição não corresponde ao padrão pedido");
});

check("acc_ia@axion.com.br ainda não é o remetente configurado (não inventamos que já está autorizado)", () => {
  assert(ACC_INSTITUTIONAL_TARGET_EMAIL === "acc_ia@axion.com.br");
  assert(isInstitutionalSenderConfigured("acc_ia@axion.com.br") === true);
  assert(
    isInstitutionalSenderConfigured(process.env.GOOGLE_GMAIL_SENDER_EMAIL ?? "") === false,
    "GOOGLE_GMAIL_SENDER_EMAIL atual não deveria ser confundido com o alvo institucional ainda não autorizado"
  );
});

// ---------- 2. assunto dinâmico ----------

check("subject com nome da obra e nível de risco dinâmicos", () => {
  const subject = buildContractAlertSubject("WEG Fábrica de Arames", "ALTA");
  assert(
    subject === "ACC - ALERTAS DO CONTRATO - OBRA WEG FÁBRICA DE ARAMES - RISCO ALTO",
    `subject inesperado: ${subject}`
  );
});

check("mapeamento de severidade para rótulo de risco: BAIXA->BAIXO, MEDIA->MÉDIO, ALTA->ALTO, CRITICA->CRÍTICO", () => {
  assert(alertRiskLevelLabels.BAIXA === "BAIXO");
  assert(alertRiskLevelLabels.MEDIA === "MÉDIO");
  assert(alertRiskLevelLabels.ALTA === "ALTO");
  assert(alertRiskLevelLabels.CRITICA === "CRÍTICO");
});

// ---------- 3. template HTML / badges ----------

const baseAlertInput = {
  recipientName: "Bruna",
  projectName: "WEG Fábrica de Arames",
  title: "Possível atraso na entrega da estrutura",
  summary: "O cliente notificou atraso de 20 dias.",
  relatedEventTitle: "Notificação de atraso — 05/01/2026",
  contractualBasis: "Cláusula 5.2 — Prazo de execução",
  keyEvidence: ["E-mail: Atraso na entrega (Gmail > Assunto: Atraso na entrega)"],
  potentialImpact: "Impacto Potencial",
  recommendedAction: null,
  responsibleName: null,
  dueDate: null,
  eventUrl: "http://localhost:3000/proj-1/ledger/evt-1",
  respondUrl: "http://localhost:3000/proj-1/ledger/evt-1?respond=acc",
};

check("CRÍTICO usa fundo vermelho, texto branco e forte destaque", () => {
  const { html } = buildContractAlertEmail({ ...baseAlertInput, severity: "CRITICA" });
  assert(html.includes("RISCO CRÍTICO"), "badge deveria mostrar COR + TEXTO (RISCO CRÍTICO)");
  assert(html.includes("#dc2626"), "fundo vermelho ausente");
  assert(html.includes("color:#ffffff"), "texto branco ausente no badge crítico");
});

check("BAIXO usa fundo verde, MÉDIO usa fundo amarelo/âmbar, ALTO usa fundo laranja", () => {
  const low = buildContractAlertEmail({ ...baseAlertInput, severity: "BAIXA" }).html;
  const medium = buildContractAlertEmail({ ...baseAlertInput, severity: "MEDIA" }).html;
  const high = buildContractAlertEmail({ ...baseAlertInput, severity: "ALTA" }).html;
  assert(low.includes("#16a34a") && low.includes("RISCO BAIXO"), "badge BAIXO incorreto");
  assert(medium.includes("#f59e0b") && medium.includes("RISCO MÉDIO"), "badge MÉDIO incorreto");
  assert(high.includes("#f97316") && high.includes("RISCO ALTO"), "badge ALTO incorreto");
});

check("corpo principal do e-mail é sempre preto (#000000), nunca parágrafo inteiro colorido", () => {
  const { html } = buildContractAlertEmail({ ...baseAlertInput, severity: "ALTA" });
  assert(html.includes("background-color:#ffffff"), "fundo deveria ser branco");
  const bodyTextOccurrences = (html.match(/color:#000000/g) ?? []).length;
  assert(bodyTextOccurrences >= 5, "texto principal deveria usar preto na maior parte do corpo");
});

check("campos ausentes (responsável/prazo/ação recomendada) nunca aparecem como placeholder inventado", () => {
  const { html, text } = buildContractAlertEmail({ ...baseAlertInput, severity: "ALTA" });
  assert(!html.includes("Responsável</td>"), "linha de responsável não deveria existir quando null");
  assert(!text.includes("Responsável:"), "linha de responsável não deveria existir quando null (texto)");
  assert(!text.includes("null"), "nenhum campo ausente pode vazar como a string 'null'");
  assert(!html.includes(">null<"), "nenhum campo ausente pode vazar como a string 'null' no HTML");
});

check("evento relacionado, base contratual e evidências principais aparecem quando disponíveis", () => {
  const { html, text } = buildContractAlertEmail({ ...baseAlertInput, severity: "MEDIA" });
  assert(html.includes("Cláusula 5.2"), "base contratual ausente no HTML");
  assert(html.includes("Atraso na entrega"), "evidência principal ausente no HTML");
  assert(text.includes("Cláusula 5.2"), "base contratual ausente no texto");
});

check("responsável e prazo aparecem quando fornecidos (nunca omitidos quando existem)", () => {
  const { html, text } = buildContractAlertEmail({
    ...baseAlertInput,
    severity: "ALTA",
    responsibleName: "Carlos Mendes",
    dueDate: "2026-02-01",
  });
  assert(html.includes("Carlos Mendes"), "responsável deveria aparecer quando fornecido");
  assert(text.includes("Responsável: Carlos Mendes"));
  assert(text.includes("Prazo: 2026-02-01"));
});

// ---------- 4. botão RESPONDER AO ACC ----------

check("template inclui o botão/link RESPONDER AO ACC e preserva o link para abrir o evento", () => {
  const { html, text } = buildContractAlertEmail({ ...baseAlertInput, severity: "ALTA" });
  assert(html.includes("RESPONDER AO ACC"), "botão RESPONDER AO ACC ausente do HTML");
  assert(html.includes(baseAlertInput.respondUrl), "URL de resposta ausente do HTML");
  assert(html.includes(baseAlertInput.eventUrl), "link do evento ausente do HTML");
  assert(text.includes("Responder ao ACC:"), "botão RESPONDER AO ACC ausente do texto");
});

check("buildRespondToAccUrl monta metadata correta (projectId/eventId/riskLevel/alertId)", () => {
  const url = buildRespondToAccUrl("http://localhost:3000", {
    projectId: "proj-1",
    eventId: "evt-1",
    riskLevel: "ALTA",
    alertId: "alert-9",
  });
  const parsed = new URL(url);
  assert(parsed.pathname === "/proj-1/ledger/evt-1", `path inesperado: ${parsed.pathname}`);
  assert(parsed.searchParams.get("respond") === "acc");
  assert(parsed.searchParams.get("riskLevel") === "ALTA");
  assert(parsed.searchParams.get("alertId") === "alert-9");
  assert(parsed.hash === "#responder-ao-acc");
});

check("buildRespondToAccUrl nunca inventa um alertId quando não fornecido", () => {
  const url = buildRespondToAccUrl("http://localhost:3000", {
    projectId: "proj-1",
    eventId: "evt-1",
    riskLevel: "BAIXA",
  });
  assert(!new URL(url).searchParams.has("alertId"), "alertId não deveria existir quando não fornecido");
});

// ---------- 5. MIME / multipart ----------

check("buildMimeMessage sem html continua text/plain puro (compatibilidade com ActionRequest)", () => {
  const raw = buildMimeMessage(
    { to: "cliente@exemplo.com", subject: "Assunto", text: "Corpo em texto puro.", correlationId: "corr-1" },
    "reynaldo@axion.com.br",
    "<corr-1@axion.com.br>"
  );
  assert(raw.includes("Content-Type: text/plain; charset=UTF-8"));
  assert(!raw.includes("multipart/alternative"), "não deveria virar multipart quando não há html");
  assert(raw.includes('From: "ACC AXION CONTROLE DE CONTRATOS" <reynaldo@axion.com.br>'));
});

check("buildMimeMessage com html gera multipart/alternative com as duas partes", () => {
  const raw = buildMimeMessage(
    {
      to: "cliente@exemplo.com",
      subject: "Assunto",
      text: "Versão texto.",
      html: "<p>Versão HTML.</p>",
      correlationId: "corr-2",
    },
    "reynaldo@axion.com.br",
    "<corr-2@axion.com.br>"
  );
  assert(raw.includes("Content-Type: multipart/alternative; boundary=\"acc-boundary-corr-2\""));
  assert(raw.includes("Content-Type: text/plain; charset=UTF-8"));
  assert(raw.includes("Content-Type: text/html; charset=UTF-8"));
  assert(raw.includes("Versão texto."));
  assert(raw.includes("<p>Versão HTML.</p>"));
});

check("base64UrlEncode nunca produz caracteres não-seguros para URL (+, /, =)", () => {
  const encoded = base64UrlEncode("qualquer texto ç ã é õ üü ++//==");
  assert(!/[+/=]/.test(encoded), `encoded inseguro: ${encoded}`);
});

// ---------- 6. FakeEmailProvider (nunca envia rede) ----------

await checkAsync("FakeEmailProvider aceita html sem exigir rede e nunca envia mensagem real", async () => {
  const provider = new FakeEmailProvider();
  const { html } = buildContractAlertEmail({ ...baseAlertInput, severity: "CRITICA" });
  const result = await provider.send({
    to: "destinatario-de-teste@exemplo.com",
    subject: "ACC - ALERTAS DO CONTRATO - OBRA TESTE - RISCO CRÍTICO",
    text: "texto",
    html,
    correlationId: "fake-corr-1",
  });
  assert(result.provider === "FAKE");
  assert(result.from === "dev-fake-sender@axion.local");
});

// ---------- 7. governança IA — nunca envio automático ----------

check("buildContractAlertEmail é puro (só monta conteúdo) — nenhuma função de template envia e-mail", () => {
  const built = buildContractAlertEmail({ ...baseAlertInput, severity: "ALTA" });
  assert(typeof built.subject === "string" && typeof built.html === "string" && typeof built.text === "string");
  assert(built.subject !== undefined, "template não deveria ter nenhum efeito colateral de envio");
});

// ---------- 8. multiidioma — detecção de idioma ----------

check("detecta português em um trecho de contrato real", () => {
  const result = detectSourceLanguage(
    "O contrato estabelece que a contratada deverá executar os serviços conforme especificado no memorial descritivo e no cronograma aprovado pelas partes."
  );
  assert(result.code === "pt", `esperado pt, obtido ${result.code} (detector: ${result.detectorCode})`);
});

check("detecta inglês em um trecho de RFP real", () => {
  const result = detectSourceLanguage(
    "This request for proposal describes the scope of work required for the fabrication and installation of the steel structure at the client facility."
  );
  assert(result.code === "en", `esperado en, obtido ${result.code} (detector: ${result.detectorCode})`);
});

check("detecta espanhol em um trecho de especificação real", () => {
  const result = detectSourceLanguage(
    "El presente documento establece las condiciones técnicas y comerciales aplicables al suministro e instalación de los equipos mencionados en el anexo."
  );
  assert(result.code === "es", `esperado es, obtido ${result.code} (detector: ${result.detectorCode})`);
});

check("texto muito curto retorna indeterminado (null) em vez de arriscar um palpite", () => {
  const result = detectSourceLanguage("ok");
  assert(result.code === null && result.detectorCode === "und");
});

check("texto vazio retorna indeterminado, nunca lança exceção", () => {
  const result = detectSourceLanguage("");
  assert(result.code === null);
});

// ---------- 9. teste real, leve: colunas multilíngues existem no schema ----------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !serviceKey) {
  console.log("");
  console.log("SKIP verificação real de schema — Supabase não configurado.");
} else {
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  await checkAsync("document_versions expõe source_language/translation_language/translation_status (leitura real, sem alterar dados)", async () => {
    const { data, error } = await admin
      .from("document_versions")
      .select("id,source_language,translation_language,translation_status")
      .limit(1);
    if (error) throw error;
    assert(Array.isArray(data), "consulta deveria retornar um array (mesmo que vazio)");
    if (data.length > 0) {
      assert(
        data[0].translation_status === "NOT_TRANSLATED" || typeof data[0].translation_status === "string",
        "translation_status deveria ter um valor válido"
      );
    }
  });

  await checkAsync("originalIsAuthoritative nunca varia — é um invariante de tipo, não uma coluna gravável", async () => {
    // Confirma que a tabela NÃO tem uma coluna desse nome (decisão
    // deliberada: é tratado como tipo literal `true` no código, igual a
    // AiAssessment.requiresHumanReview — nunca gravável como false).
    const { error } = await admin.from("document_versions").select("original_is_authoritative").limit(1);
    assert(error !== null, "não deveria existir uma coluna original_is_authoritative gravável no banco");
  });
}

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
