// Parser PURO do assunto do "Relatório Semanal" — ex.: "(W37) <cliente> -
// Relatório Semanal". W37 é a SEMANA DA OBRA (contagem do projeto),
// NUNCA convertida para semana civil/ISO. Sem WNN => NOT_IDENTIFIED
// (revisão humana; nunca inventa valor).
//
// Cliente/projeto só é extraído quando inequívoco: o token entre o
// WNN e o marcador "Relatório Semanal". Nunca é usado para autorizar
// nada — só como pista de exibição/classificação.

export interface ParsedWorkWeekSubject {
  originalTitle: string;
  workWeekNumber: number | null;
  workWeekLabel: string | null;
  workWeekStatus: "IDENTIFIED" | "NOT_IDENTIFIED";
  /** Token do cliente/projeto (ex.: sigla) — só quando inequívoco; null caso contrário. */
  clientToken: string | null;
  isWeeklyReport: boolean;
}

// (W37), [W37], W37, w 37, S37/SEM 37 NÃO são aceitos: só o padrão W<n>.
const WORK_WEEK_REGEX = /(?:^|[^A-Za-z0-9])[\(\[]?\s*[Ww]\s?(\d{1,3})\s*[\)\]]?(?=$|[^0-9])/;
const WEEKLY_REPORT_REGEX = /relat[óo]rio\s+semanal/i;

function normalizeSpaces(value: string): string {
  return value.replace(/[–—‒]/g, "-").replace(/\s+/g, " ").trim();
}

export function parseWorkWeekSubject(subject: string): ParsedWorkWeekSubject {
  const originalTitle = subject ?? "";
  const normalized = normalizeSpaces(originalTitle);
  const isWeeklyReport = WEEKLY_REPORT_REGEX.test(normalized);

  const match = WORK_WEEK_REGEX.exec(normalized);
  if (!match) {
    return {
      originalTitle,
      workWeekNumber: null,
      workWeekLabel: null,
      workWeekStatus: "NOT_IDENTIFIED",
      clientToken: null,
      isWeeklyReport,
    };
  }

  const number = Number(match[1]);
  if (!Number.isInteger(number) || number < 1 || number > 260) {
    return {
      originalTitle,
      workWeekNumber: null,
      workWeekLabel: null,
      workWeekStatus: "NOT_IDENTIFIED",
      clientToken: null,
      isWeeklyReport,
    };
  }

  // Cliente/projeto: texto entre o fim do WNN e "Relatório Semanal",
  // limpo de pontuação; só aceito quando vira UM token alfanumérico.
  let clientToken: string | null = null;
  if (isWeeklyReport) {
    const afterWeek = normalized.slice(match.index + match[0].length);
    const beforeReport = afterWeek.split(WEEKLY_REPORT_REGEX)[0] ?? "";
    const cleaned = beforeReport.replace(/[-–—:|,;]+/g, " ").replace(/\s+/g, " ").trim();
    if (/^[A-Za-z0-9&.]{2,}$/.test(cleaned)) clientToken = cleaned.toUpperCase();
  }

  return {
    originalTitle,
    workWeekNumber: number,
    workWeekLabel: `W${number}`,
    workWeekStatus: "IDENTIFIED",
    clientToken,
    isWeeklyReport,
  };
}
