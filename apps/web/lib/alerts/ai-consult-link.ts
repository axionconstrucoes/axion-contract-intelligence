// Link "CONSULTAR IA" dos alertas. Puro (sem server-only): o e-mail só leva o
// destino; a consulta acontece na página do ACC, com login, autorização e
// vínculo com a obra verificados no servidor. Nada é aberto dentro do e-mail.

export type AiConsultSubject = "evento" | "providencia";

export function buildAiConsultPath(input: { projectId: string; subject: AiConsultSubject; id: string }): string {
  return `/alertas/consulta-ia/${encodeURIComponent(input.projectId)}/${input.subject}/${encodeURIComponent(input.id)}`;
}

export function buildAiConsultUrl(input: {
  baseUrl: string;
  projectId: string;
  subject: AiConsultSubject;
  id: string;
}): string {
  return `${input.baseUrl.replace(/\/+$/, "")}${buildAiConsultPath(input)}`;
}
