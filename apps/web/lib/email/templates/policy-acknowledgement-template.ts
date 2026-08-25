// Template institucional do Termo ACC.
// Puro, sem I/O.

export const POLICY_ACKNOWLEDGEMENT_SUBJECT =
  "ACC - Termo de Ciência da Política de Uso de Recursos Corporativos";

export const POLICY_ACKNOWLEDGEMENT_REMINDER_SUBJECT =
  "ACC - Lembrete - Termo de Ciência da Política de Uso de Recursos Corporativos";

export interface PolicyAcknowledgementEmailInput {
  recipientName: string | null;
  termTitle: string;
  termVersion: string;
  publicationDate: string;
  approvalUrl: string;
  isReminder: boolean;
  logoCid: string;
}

export interface PolicyAcknowledgementEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildPolicyAcknowledgementEmail(
  input: PolicyAcknowledgementEmailInput
): PolicyAcknowledgementEmail {
  const subject = input.isReminder
    ? POLICY_ACKNOWLEDGEMENT_REMINDER_SUBJECT
    : POLICY_ACKNOWLEDGEMENT_SUBJECT;

  const greeting = input.recipientName
    ? `Olá, ${input.recipientName}`
    : "Olá";

  const intro = input.isReminder
    ? "Este é um lembrete para que você leia e aprove o Termo de Ciência da Política de Uso de Recursos Corporativos."
    : "Para utilizar o AXION Acompanhamento de Contratos (ACC), é necessário que você leia e aprove o Termo de Ciência da Política de Uso de Recursos Corporativos.";

  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="margin:0;padding:24px 0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <tr>
    <td align="center">

      <table role="presentation" width="680" cellpadding="0" cellspacing="0"
        style="width:680px;max-width:96%;background:#ffffff;border-collapse:separate;border-spacing:0;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">

        <tr>
          <td style="background:#991b1f;padding:20px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>

                <td width="90" valign="middle">
                  <img
                    src="cid:${escapeHtml(input.logoCid)}"
                    width="66"
                    height="66"
                    alt="ACC"
                    style="display:block;width:66px;height:66px;border:0;"
                  />
                </td>

                <td align="center" valign="middle"
                  style="color:#ffffff;font-size:25px;line-height:32px;font-weight:700;letter-spacing:0.01em;">
                  AXION CONTROLE DE CONTRATOS - IA
                </td>

                <td width="90">&nbsp;</td>

              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:28px 30px 12px 30px;color:#18181b;font-size:15px;line-height:1.55;">

            <p style="margin:0 0 16px 0;font-size:18px;font-weight:700;">
              ${escapeHtml(greeting)}
            </p>

            <p style="margin:0 0 14px 0;">
              ${escapeHtml(intro)}
            </p>

            <p style="margin:0 0 22px 0;">
              Este termo apresenta as condições de uso do sistema, o tratamento de informações
              corporativas, os seus direitos e deveres e as responsabilidades relacionadas à
              utilização dos recursos fornecidos pela AXION.
            </p>

          </td>
        </tr>

        <tr>
          <td style="padding:0 30px 20px 30px;">

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
              style="border:1px solid #b91c1c;border-radius:9px;background:#fffafa;">
              <tr>
                <td style="padding:20px 22px;">

                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                    style="font-size:14px;line-height:1.45;color:#18181b;">

                    <tr>
                      <td width="135" style="padding:4px 0;font-weight:700;">Documento:</td>
                      <td style="padding:4px 0;">${escapeHtml(input.termTitle)}</td>
                    </tr>

                    <tr>
                      <td style="padding:4px 0;font-weight:700;">Versão:</td>
                      <td style="padding:4px 0;">${escapeHtml(input.termVersion)}</td>
                    </tr>

                    <tr>
                      <td style="padding:4px 0;font-weight:700;">Data de publicação:</td>
                      <td style="padding:4px 0;">${escapeHtml(input.publicationDate)}</td>
                    </tr>

                    <tr>
                      <td style="padding:4px 0;font-weight:700;vertical-align:top;">Descrição:</td>
                      <td style="padding:4px 0;">
                        Estabelece as condições de uso dos recursos corporativos no ACC e as
                        finalidades do tratamento de informações.
                      </td>
                    </tr>

                  </table>

                </td>
              </tr>
            </table>

          </td>
        </tr>

        <tr>
          <td style="padding:0 30px 14px 30px;color:#18181b;font-size:14px;line-height:1.5;">
            Clique no botão abaixo para ler o termo completo e registrar sua ciência.
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:8px 30px 26px 30px;">

            <a
              href="${escapeHtml(input.approvalUrl)}"
              style="display:inline-block;background:#b5090b;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 28px;border-radius:8px;"
            >
              LER E APROVAR TERMO
            </a>

          </td>
        </tr>

        <tr>
          <td style="padding:18px 30px 24px 30px;border-top:1px solid #d1d5db;text-align:center;color:#6b7280;font-size:12px;line-height:1.5;">
            Este é um e-mail automático do ACC AXION CONTROLE DE CONTRATOS - IA.<br />
            Em caso de dúvidas, entre em contato com o administrador do sistema.
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>`.trim();

  const text = [
    "AXION CONTROLE DE CONTRATOS - IA",
    "",
    greeting,
    "",
    intro,
    "",
    `Documento: ${input.termTitle}`,
    `Versão: ${input.termVersion}`,
    `Data de publicação: ${input.publicationDate}`,
    "",
    "Clique no endereço abaixo para ler o termo completo e registrar sua ciência:",
    input.approvalUrl,
    "",
    "Este é um e-mail automático do ACC AXION CONTROLE DE CONTRATOS - IA.",
  ].join("\n");

  return { subject, html, text };
}