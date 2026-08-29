// Gera prévias ESTÁVEIS (fora de temp, fora do git) do e-mail de alerta
// de contrato — HTML, texto puro e MIME completo — usando SOMENTE dados
// FICTÍCIOS/determinísticos (nenhum acesso a rede/DB/Drive/e-mail real,
// nenhum destinatário real, nenhum projeto contratado real).
//
// Reaproveita os mesmos builders puros usados pelos testes (mesmo padrão
// de scripts/test-alert-email-mime-confront-evidence.mjs) — nunca duplica
// a lógica de template.
//
// IMPORTANTE — esta prévia NUNCA pode ser confundida com um contrato
// real: assunto prefixado "[TESTE]", banner "PRÉVIA DE TESTE — NÃO
// ENVIAR" em toda saída, projeto identificado como "PROJETO FICTÍCIO —
// NÃO CONTRATADO" (mesmo marcador checado por
// apps/web/lib/email/fixture-safety-guard.ts — se este texto algum dia
// chegasse ao fluxo de envio real, o guard interrompe o processo), e
// destinatário em domínio reservado (.invalid, RFC 2606 — nunca entrega
// de verdade).
//
// Também demonstra a regra do risco CRÍTICO (Bloco 3) através da mesma
// função pura usada em produção (deriveScheduleDelaySeverity) — nunca
// hardcoding de "CRITICA" sem passar pela regra estruturada.
//
// Uso:
//   node scripts/generate-alert-email-preview.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const { buildContractAlertEmail } = await import("../apps/web/lib/email/templates/contract-alert-template.ts");
const { buildConfrontationBlock } = await import("../apps/web/lib/email/build-confrontation-block.ts");
const { appendAccEmailSignature, ACC_EMAIL_LOGO_CID } = await import("../apps/web/lib/email/branding/acc-email-signature.ts");
const { loadAccLogoInlineImage } = await import("../apps/web/lib/email/branding/load-acc-logo-inline-image.ts");
const { buildMimeMessage } = await import("../apps/web/lib/email/mime-message.ts");
const { EMAIL_FIXTURE_PROJECT_NAME_MARKER } = await import("../apps/web/lib/email/fixture-safety-guard.ts");
const { deriveScheduleDelaySeverity } = await import(
  "../apps/web/lib/ai/experts/planning-director/derive-schedule-delay-severity.ts"
);

const OUT_DIR = "C:\\Users\\User\\axion-acc-previews";
mkdirSync(OUT_DIR, { recursive: true });

// Nomes/identificadores 100% fictícios — nunca um contrato real ("DUX
// Vinhedo - SP" é o exemplo histórico deste projeto, mantido só como
// rótulo de demonstração, sempre acompanhado do marcador obrigatório).
const FIXTURE_PROJECT_NAME = `DUX Vinhedo - SP — ${EMAIL_FIXTURE_PROJECT_NAME_MARKER}`;
const FIXTURE_CONTRACT_LABEL = "FIXTURE-CP-000 (projeto fictício, nunca contratado)";
const FIXTURE_PERSON_NAME = "Responsável Fictício (prévia de teste)";
// example.invalid é reservado pela RFC 2606 especificamente para nunca
// resolver/entregar de verdade — garante que esta prévia não pode virar
// um envio real mesmo se alguém tentar reenviar o .eml manualmente.
const FIXTURE_RECIPIENT_EMAIL = "destinatario-ficticio@example.invalid";
const FIXTURE_SENDER_EMAIL = "acc_ia_preview@example.invalid";

// Regra do risco CRÍTICO (Bloco 3) — passa pela MESMA função pura usada
// (quando integrada) em produção, nunca um "CRITICA" hardcoded direto no
// input do template. Demonstra exatamente a combinação exigida: prazo
// contratual ultrapassado + recuperabilidade estruturada IMPROVAVEL.
const fixtureScheduleRecoverability = {
  classification: "IMPROVAVEL",
  contractualDeadlineOrLimitExceeded: true,
  evidence: {
    criticalPath: "Etapa 3 (Fundação) está no caminho crítico da obra fictícia.",
    floatDays: "Folga total esgotada (0 dias) desde 2026-08-22 (fixture).",
    plannedVsActualProgress: "Avanço planejado 42% x realizado 24% na data-base da fixture.",
    productivity: "Produtividade medida 55% da linha de base do orçamento (fixture).",
    mobilizedResources: "Equipe mobilizada abaixo do previsto no cronograma (fixture).",
    remainingDuration: "Duração remanescente da etapa reestimada em 34 dias (fixture).",
    recoveryPlan: "Nenhum plano de recuperação formalmente apresentado até a data-base (fixture).",
    reinforcementReprogrammingOrExtensionNeeded:
      "Reforço de equipe e reprogramação formal identificados como necessários (fixture).",
  },
  justification:
    "Avaliação FICTÍCIA de demonstração: caminho crítico comprometido, folga esgotada e ausência de plano de recuperação sustentam classificação IMPROVAVEL, combinada ao prazo contratual já ultrapassado — exatamente a combinação que a regra do Bloco 3 exige para elevar a CRÍTICO.",
  assessedAt: "2026-08-29T12:00:00.000Z",
};
const { severity: fixtureSeverity } = deriveScheduleDelaySeverity(fixtureScheduleRecoverability);
if (fixtureSeverity !== "CRITICA") {
  throw new Error(
    `Fixture do Diretor de Planejamento deveria produzir CRITICA (para demonstrar o selo do Bloco 4), obtido ${fixtureSeverity} — corrija a fixture, nunca force o selo manualmente.`
  );
}

const confrontationBlock = buildConfrontationBlock(
  {
    clauseNumber: "7.2",
    eventBasis: "Atraso de 18 dias na entrega da Etapa 3 (Fundação), registrado no Diário de Obra em 2026-08-20 (fixture).",
    clauseBasis: `Cláusula 7.2 do contrato fictício ${FIXTURE_CONTRACT_LABEL}: prazo máximo de 10 dias corridos de atraso por etapa antes de multa contratual.`,
    summary: "O atraso de 18 dias ultrapassa em 8 dias o limite contratual fictício da Cláusula 7.2, sujeitando o contrato-exemplo a multa e possível revisão de cronograma.",
    reviewNote: "Confirmado atraso de 18 dias por comparação direta entre o Diário de Obra (evento) e o prazo da Cláusula 7.2 (10 dias); multa aplicável conforme contrato fictício.",
    reviewedAt: "2026-08-25T14:30:00.000Z",
  },
  FIXTURE_PERSON_NAME,
  "https://acc.axion.com.br/fixture-preview-nao-enviar/ledger/evt-4821"
);

const actionButtons = [
  { action: "ACKNOWLEDGE", url: "https://acc.axion.com.br/email-actions/preview-token-acknowledge" },
  { action: "ASSUME_RESPONSIBILITY", url: "https://acc.axion.com.br/email-actions/preview-token-assume" },
  { action: "SET_DEADLINE", url: "https://acc.axion.com.br/email-actions/preview-token-deadline" },
  { action: "RESPOND", url: "https://acc.axion.com.br/email-actions/preview-token-respond" },
];

const inlineLogo = loadAccLogoInlineImage(path.join(repoRoot, "apps", "web"));

const built = buildContractAlertEmail({
  recipientName: FIXTURE_PERSON_NAME,
  projectName: FIXTURE_PROJECT_NAME,
  severity: fixtureSeverity,
  title: "[FIXTURE] Atraso na Etapa 3 (Fundação) ultrapassa limite contratual",
  summary: `A obra fictícia ${FIXTURE_PROJECT_NAME} registrou (dado de demonstração) atraso de 18 dias na Etapa 3, ultrapassando o limite de 10 dias previsto na Cláusula 7.2 do contrato-exemplo — sem plano de recuperação viável identificado.`,
  relatedEventTitle: "[FIXTURE] Diário de Obra 2026-08-20 — Atraso Etapa 3",
  contractualBasis: null,
  confrontationBlocks: [confrontationBlock],
  keyEvidence: [
    {
      kind: "EMAIL",
      url: "https://acc.axion.com.br/fixture-preview-nao-enviar/documentos/email-9931",
      direction: "RECEIVED",
      from: "engenheiro.ficticio@example.invalid",
      to: FIXTURE_RECIPIENT_EMAIL,
      date: "20/08/2026 09:14",
      subject: "[FIXTURE] Atualização de cronograma — Etapa 3 (Fundação) atrasada",
    },
    {
      kind: "OTHER",
      url: "https://acc.axion.com.br/fixture-preview-nao-enviar/ledger/evt-4821",
      sourceTypeLabel: "Diário de Obra",
      label: "[FIXTURE] Registro de campo 2026-08-20 — Fundação",
    },
  ],
  potentialImpact: "Risco de multa contratual e necessidade de revisão do cronograma geral da obra (dado de demonstração).",
  recommendedAction: "Convocar reunião com a construtora parceira em até 3 dias úteis para negociar plano de recuperação de prazo (dado de demonstração).",
  responsibleName: FIXTURE_PERSON_NAME,
  dueDate: "2026-09-02",
  eventUrl: "https://acc.axion.com.br/fixture-preview-nao-enviar/ledger/evt-4821",
  actionButtons,
  hasInlineLogo: Boolean(inlineLogo),
});

// [TESTE] no assunto — aplicado SÓ aqui na prévia (nunca dentro de
// buildContractAlertSubject, que é o mesmo builder usado por alertas
// reais). Preserva o assunto real completo depois do prefixo, só para
// facilitar comparação visual.
const previewSubject = `[TESTE] ${built.subject}`;

// Banner de segurança da PRÉVIA — deliberadamente feito à parte do
// template de produção (nunca em contract-alert-template.ts): um alerta
// real nunca deve carregar este aviso, e esta prévia nunca deve deixar
// de carregá-lo. Tabela + estilos inline (mesma disciplina de
// compatibilidade do restante do e-mail), cor distinta do selo CRÍTICO
// (azul, nunca vermelho/amarelo-preto) para nunca ser confundido com a
// faixa de risco do Bloco 4.
const FIXTURE_PROJECT_NAME_TEXT_ESCAPED = FIXTURE_PROJECT_NAME.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function buildPreviewOnlyBannerHtml() {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#1d4ed8;margin-bottom:12px;border-radius:6px;">
    <tr><td style="padding:10px 16px;text-align:center;">
      <span style="display:block;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;letter-spacing:0.04em;color:#ffffff;">PRÉVIA DE TESTE — NÃO ENVIAR</span>
      <span style="display:block;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#dbeafe;margin-top:2px;">${FIXTURE_PROJECT_NAME_TEXT_ESCAPED}</span>
    </td></tr>
  </table>`;
}

const previewBannerText = ["PRÉVIA DE TESTE — NÃO ENVIAR", FIXTURE_PROJECT_NAME, ""].join("\n");

const previewHtml = `${buildPreviewOnlyBannerHtml()}${built.html}`;
const previewText = `${previewBannerText}\n${built.text}`;

// includeLogoImage=false: espelha exatamente send-contract-alert-email.ts
// — o cabeçalho do alerta já mostra o logo (buildHeaderHtml), então a
// assinatura no rodapé só traz o texto/disclaimer, nunca a imagem de novo.
const withSignature = appendAccEmailSignature({ text: previewText, html: previewHtml }, Boolean(inlineLogo), false);

// Corpo HTML exatamente como seria enviado (fragmento, sem <html>/<meta>
// — cliente de e-mail real lê o charset do header MIME Content-Type, ver
// alert-email.eml abaixo, nunca de uma <meta> no corpo).
const htmlBodyPath = path.join(OUT_DIR, "alert-email-body.html");
writeFileSync(htmlBodyPath, withSignature.html ?? previewHtml, "utf8");

// Versão só para abrir direto num navegador: mesmo corpo, envolvido num
// shell HTML mínimo com <meta charset> (sem isso, acentuação quebra na
// tela por falta do header MIME que o navegador teria num e-mail real) E
// com "cid:acc-logo-signature" substituído por um data: URI — só o
// navegador precisa disso (cid: só funciona dentro de um cliente de
// e-mail real, que resolve o Content-ID a partir da parte MIME anexada).
// O .eml (mecanismo cid: real) e o .html "corpo exato" acima NUNCA
// passam por essa substituição.
const htmlPath = path.join(OUT_DIR, "alert-email.html");
const bodyForBrowser = inlineLogo
  ? (withSignature.html ?? previewHtml).replace(
      `src="cid:${ACC_EMAIL_LOGO_CID}"`,
      `src="data:${inlineLogo.mimeType};base64,${inlineLogo.contentBase64}"`
    )
  : (withSignature.html ?? previewHtml);
const browserPreviewHtml = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>[TESTE] Prévia — Alerta de Contrato ACC (PROJETO FICTÍCIO)</title></head><body>${bodyForBrowser}</body></html>`;
writeFileSync(htmlPath, browserPreviewHtml, "utf8");

const textPath = path.join(OUT_DIR, "alert-email.txt");
writeFileSync(textPath, withSignature.text, "utf8");

// buildMimeMessage formata o From sozinho (formatSenderHeader é chamada
// UMA vez, aqui dentro) — nunca pré-formatar antes de passar, ou o
// header sai duplicado/aninhado (o bug que esta prévia tinha antes).
// From/To em domínio .invalid (RFC 2606): mesmo que este .eml seja
// aberto por engano num cliente de e-mail e "reenviado", não há
// destinatário real algum para entregar.
const mime = buildMimeMessage(
  {
    to: FIXTURE_RECIPIENT_EMAIL,
    subject: previewSubject,
    text: withSignature.text,
    html: withSignature.html,
    inlineImages: inlineLogo ? [inlineLogo] : undefined,
    correlationId: "preview-correlation-id",
  },
  FIXTURE_SENDER_EMAIL,
  "<preview-message-id@example.invalid>"
);
const mimePath = path.join(OUT_DIR, "alert-email.eml");
writeFileSync(mimePath, mime, "utf8");

console.log("Prévias de e-mail geradas em:", OUT_DIR);
console.log(" -", htmlBodyPath);
console.log(" -", htmlPath);
console.log(" -", textPath);
console.log(" -", mimePath);
console.log("Assunto:", previewSubject);
console.log("Severidade da fixture (via deriveScheduleDelaySeverity):", fixtureSeverity);
console.log("Logo inline embutido:", Boolean(inlineLogo));
console.log("");
console.log("ESTA É UMA PRÉVIA DE TESTE — NENHUM E-MAIL REAL FOI ENVIADO. Projeto/destinatário 100% fictícios.");
