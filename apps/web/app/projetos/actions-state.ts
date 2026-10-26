export type CreateProjectState = {
  error: string | null;
};

export const initialCreateProjectState: CreateProjectState = { error: null };

export type UpdateProjectState = {
  error: string | null;
};

export const initialUpdateProjectState: UpdateProjectState = { error: null };

// Origem da edição — mapeada para destinos fixos (nunca uma URL livre
// vinda do formulário): seleção de projetos ou Dashboard do projeto.
export type EditProjectOrigin = "selecao" | "projeto";

export function editProjectReturnPath(projectId: string, origin: EditProjectOrigin): string {
  return origin === "projeto" ? `/${projectId}/dashboard` : "/projetos";
}
