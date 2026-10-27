// Arquivos do tutorial permanente do ACC (PDF para consulta e PowerPoint editável).
// Ficam em apps/web/content/tutorial — FORA de public/ de propósito: só são entregues pela rota autenticada
// /{obra}/ajuda/tutorial/{formato}. Conteúdo: dados fictícios, sem informação confidencial de contrato.

export const TUTORIAL_FILES = {
  pdf: {
    fileName: "ACC-apresentacao-e-tutorial.pdf",
    contentType: "application/pdf",
    disposition: "inline",
    label: "Abrir o PDF",
  },
  pptx: {
    fileName: "ACC-apresentacao-e-tutorial.pptx",
    contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    disposition: "attachment",
    label: "Baixar o PowerPoint",
  },
} as const;

export type TutorialFormat = keyof typeof TUTORIAL_FILES;

export function isTutorialFormat(value: string): value is TutorialFormat {
  return Object.prototype.hasOwnProperty.call(TUTORIAL_FILES, value);
}
