import type { ScheduleActivity } from "@axion/types";

export const scheduleActivities: ScheduleActivity[] = [
  { id: "sch-arena-01", projectId: "prj-arena", name: "Fundações", baselineStart: "2025-02-10", baselineEnd: "2025-04-30", currentStart: "2025-02-10", currentEnd: "2025-05-08", status: "CONCLUIDA" },
  { id: "sch-arena-02", projectId: "prj-arena", name: "Estrutura e Cobertura", baselineStart: "2025-05-01", baselineEnd: "2025-09-30", currentStart: "2025-05-01", currentEnd: "2025-10-20", status: "ATRASADA" },
  { id: "sch-arena-03", projectId: "prj-arena", name: "Paisagismo", baselineStart: "2025-10-01", baselineEnd: "2025-12-15", currentStart: "2026-01-15", currentEnd: "2026-03-01", status: "ATRASADA" },
  { id: "sch-ind-01", projectId: "prj-industrial", name: "Fundações Especiais", baselineStart: "2025-06-02", baselineEnd: "2025-08-15", currentStart: "2025-06-02", currentEnd: "2025-09-10", status: "CONCLUIDA" },
  { id: "sch-ind-02", projectId: "prj-industrial", name: "Estrutura Metálica e Elétrica", baselineStart: "2025-08-16", baselineEnd: "2026-03-30", currentStart: "2025-08-16", currentEnd: "2026-05-15", status: "ATRASADA" },
];
