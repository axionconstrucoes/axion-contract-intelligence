import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";
import type { ProjectPermission } from "@axion/types";

export type ContractReviewEvidence = {
  id: string;
  subject: string | null;
  snippet: string | null;
  sentAt: string;
  direction: string | null;
  fromAddress: string | null;
  toAddress: string | null;
};

export type ContractReviewCandidate = {
  id: string;
  projectId: string;
  providerThreadId: string;
  status: string;
  priority: string;
  score: number;
  categories: string[];
  subject: string;
  messageCount: number;
  firstMessageAt: string;
  lastMessageAt: string;
  evidence: ContractReviewEvidence[];
};

export async function getContractReviewCandidates(
  projectId: string
): Promise<ContractReviewCandidate[]> {
  const supabase =
    await createSupabaseServerClient();

  const {
    data: candidates,
    error: candidateError,
  } = await supabase
    .from("email_thread_event_candidates")
    .select("id,project_id,provider_thread_id,status,priority,score,categories,subject,message_count,first_message_at,last_message_at")
    .eq("project_id", projectId)
    .eq("status", "PENDING_REVIEW")
    .order("score", {
      ascending: false,
    });

  if (candidateError) {
    throw new Error(
      `Falha ao carregar candidatos: ${candidateError.message}`
    );
  }

  if (!candidates?.length) {
    return [];
  }

  const candidateIds =
    candidates.map((candidate) => candidate.id);

  const {
    data: links,
    error: linkError,
  } = await supabase
    .from("email_thread_event_candidate_emails")
    .select("candidate_id,email_id")
    .in("candidate_id", candidateIds);

  if (linkError) {
    throw new Error(
      `Falha ao carregar evidencias dos candidatos: ${linkError.message}`
    );
  }

  const emailIds =
    Array.from(
      new Set(
        (links ?? []).map(
          (link) => link.email_id
        )
      )
    );

  const {
    data: emails,
    error: emailError,
  } = emailIds.length
    ? await supabase
        .from("emails")
        .select("id,subject,snippet,sent_at,direction,from_address,to_address")
        .in("id", emailIds)
    : {
        data: [],
        error: null,
      };

  if (emailError) {
    throw new Error(
      `Falha ao carregar emails: ${emailError.message}`
    );
  }

  const emailsById =
    new Map(
      (emails ?? []).map(
        (email) => [
          email.id,
          {
            id: email.id,
            subject: email.subject,
            snippet: email.snippet,
            sentAt: email.sent_at,
            direction: email.direction,
            fromAddress: email.from_address,
            toAddress: email.to_address,
          } satisfies ContractReviewEvidence,
        ]
      )
    );

  const emailIdsByCandidate =
    new Map<string, string[]>();

  for (const link of links ?? []) {
    const current =
      emailIdsByCandidate.get(
        link.candidate_id
      ) ?? [];

    current.push(link.email_id);

    emailIdsByCandidate.set(
      link.candidate_id,
      current
    );
  }

  return candidates.map((candidate) => {
    const evidence =
      (
        emailIdsByCandidate.get(
          candidate.id
        ) ?? []
      )
        .map(
          (emailId) =>
            emailsById.get(emailId)
        )
        .filter(
          (
            email
          ): email is ContractReviewEvidence =>
            Boolean(email)
        )
        .sort(
          (a, b) =>
            new Date(a.sentAt).getTime() -
            new Date(b.sentAt).getTime()
        );

    return {
      id: candidate.id,
      projectId: candidate.project_id,
      providerThreadId:
        candidate.provider_thread_id,
      status: candidate.status,
      priority: candidate.priority,
      score: candidate.score,
      categories:
        candidate.categories ?? [],
      subject: candidate.subject,
      messageCount:
        candidate.message_count,
      firstMessageAt:
        candidate.first_message_at,
      lastMessageAt:
        candidate.last_message_at,
      evidence,
    };
  });
}


export async function getCurrentProjectPermission(
  projectId: string
): Promise<ProjectPermission | null> {
  const supabase =
    await createSupabaseServerClient();

  const {
    data: authData,
  } =
    await supabase.auth.getUser();

  const user =
    authData.user;

  if (!user) {
    return null;
  }

  const {
    data,
    error,
  } = await supabase
    .from("project_memberships")
    .select("permission")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Falha ao verificar permissao: ${error.message}`
    );
  }

  return (data?.permission as ProjectPermission | undefined) ?? null;
}

// COLABORADOR e GESTOR têm o mesmo nível de acesso a conteúdo do
// projeto (edição de documentos/cláusulas/eventos etc.) nesta fase —
// o escopo de GESTOR ainda será definido explicitamente (ver módulo
// Usuários e Permissões), mas por ora ele não deve ter menos acesso
// de conteúdo do que um Colaborador.
export function canEditProjectContent(permission: ProjectPermission | null): boolean {
  return permission === "ADMINISTRADOR";
}

// Ações restritas a Administrador do projeto (gestão de configuração,
// integrações, membros). GESTOR nunca herda estas ações nesta fase.
export function isProjectAdministrator(permission: ProjectPermission | null): boolean {
  return permission === "ADMINISTRADOR";
}
