import type { ProjectMembership, User } from "@axion/types";
import { DEV_PROJECT_ID } from "./constants";

export const users: User[] = [
  { id: "usr-ana", name: "Ana Beatriz Souza", email: "ana.souza@axion.com.br", origin: "AXION_INTERNO", title: "Gerente de Projetos", avatarInitials: "AS" },
  { id: "usr-fernanda", name: "Fernanda Ribeiro", email: "fernanda.ribeiro@axion.com.br", origin: "AXION_INTERNO", title: "Coordenadora de Contratos", avatarInitials: "FR" },
  { id: "usr-joao", name: "João Pedro Alves", email: "joao.alves@axion.com.br", origin: "AXION_INTERNO", title: "Engenheiro de Obra", avatarInitials: "JA" },
  { id: "usr-roberto", name: "Roberto Nunes", email: "roberto.nunes@itaguai.rj.gov.br", origin: "TERCEIRO", title: "Fiscal de Obras — Prefeitura de Itaguaí", avatarInitials: "RN" },
  { id: "usr-patricia", name: "Patrícia Gomes", email: "patricia.gomes@vetraria.com.br", origin: "TERCEIRO", title: "Gestora de Contratos — Vetraria", avatarInitials: "PG" },
];

const MOCK_MEMBERSHIP_CREATED_AT = "2026-01-01T00:00:00-03:00";

export const projectMemberships: ProjectMembership[] = [
  { userId: "usr-ana", projectId: DEV_PROJECT_ID, permission: "ADMINISTRADOR", status: "ACTIVE", area: "DIRETORIA", createdAt: MOCK_MEMBERSHIP_CREATED_AT },
  { userId: "usr-fernanda", projectId: DEV_PROJECT_ID, permission: "COLABORADOR", status: "ACTIVE", area: "JURÍDICO", createdAt: MOCK_MEMBERSHIP_CREATED_AT },
  { userId: "usr-joao", projectId: DEV_PROJECT_ID, permission: "COLABORADOR", status: "ACTIVE", area: "ENGENHARIA", createdAt: MOCK_MEMBERSHIP_CREATED_AT },
  { userId: "usr-roberto", projectId: DEV_PROJECT_ID, permission: "LEITURA", status: "ACTIVE", area: null, createdAt: MOCK_MEMBERSHIP_CREATED_AT },

  { userId: "usr-ana", projectId: "prj-industrial", permission: "ADMINISTRADOR", status: "ACTIVE", area: "DIRETORIA", createdAt: MOCK_MEMBERSHIP_CREATED_AT },
  { userId: "usr-fernanda", projectId: "prj-industrial", permission: "COLABORADOR", status: "ACTIVE", area: "JURÍDICO", createdAt: MOCK_MEMBERSHIP_CREATED_AT },
  { userId: "usr-patricia", projectId: "prj-industrial", permission: "LEITURA", status: "ACTIVE", area: null, createdAt: MOCK_MEMBERSHIP_CREATED_AT },
];
