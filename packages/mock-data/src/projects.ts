import type { Project } from "@axion/types";
import { DEV_PROJECT_ID } from "./constants";

export const projects: Project[] = [
  {
    id: DEV_PROJECT_ID,
    code: "ARN-2025-001",
    name: "Arena Multiuso Zona Norte",
    client: "Prefeitura Municipal de Itaguaí",
    status: "ATIVO",
    location: "Itaguaí, RJ",
    contractNumber: "CT-2025-0142",
    startDate: "2025-02-10",
    baselineEndDate: "2026-11-30",
  },
  {
    id: "prj-industrial",
    code: "VTR-2025-002",
    name: "Complexo Industrial Vetraria",
    client: "Vetraria Componentes Ltda.",
    status: "ATIVO",
    location: "Cabo de Santo Agostinho, PE",
    contractNumber: "CT-2025-0387",
    startDate: "2025-06-02",
    baselineEndDate: "2026-12-15",
  },
];
