import type { ProjectMembership, User } from "@axion/types";

export const users: User[] = [
  { id: "usr-ana", name: "Ana Beatriz Souza", email: "ana.souza@axion.com.br", origin: "AXION_INTERNO", title: "Gerente de Projetos", avatarInitials: "AS" },
  { id: "usr-fernanda", name: "Fernanda Ribeiro", email: "fernanda.ribeiro@axion.com.br", origin: "AXION_INTERNO", title: "Coordenadora de Contratos", avatarInitials: "FR" },
  { id: "usr-joao", name: "João Pedro Alves", email: "joao.alves@axion.com.br", origin: "AXION_INTERNO", title: "Engenheiro de Obra", avatarInitials: "JA" },
  { id: "usr-roberto", name: "Roberto Nunes", email: "roberto.nunes@itaguai.rj.gov.br", origin: "TERCEIRO", title: "Fiscal de Obras — Prefeitura de Itaguaí", avatarInitials: "RN" },
  { id: "usr-patricia", name: "Patrícia Gomes", email: "patricia.gomes@vetraria.com.br", origin: "TERCEIRO", title: "Gestora de Contratos — Vetraria", avatarInitials: "PG" },
];

export const projectMemberships: ProjectMembership[] = [
  { userId: "usr-ana", projectId: "prj-arena", permission: "ADMIN" },
  { userId: "usr-fernanda", projectId: "prj-arena", permission: "EDITOR" },
  { userId: "usr-joao", projectId: "prj-arena", permission: "EDITOR" },
  { userId: "usr-roberto", projectId: "prj-arena", permission: "VIEWER" },

  { userId: "usr-ana", projectId: "prj-industrial", permission: "ADMIN" },
  { userId: "usr-fernanda", projectId: "prj-industrial", permission: "EDITOR" },
  { userId: "usr-patricia", projectId: "prj-industrial", permission: "VIEWER" },
];
