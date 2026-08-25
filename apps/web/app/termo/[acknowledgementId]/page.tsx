import { notFound, redirect } from "next/navigation";

import {
  createSupabaseServerClient,
} from "@axion/db/server";

import {
  PolicyApprovalForm,
} from "./approval-form";

import {
  PolicyViewTracker,
} from "./policy-view-tracker";

export default async function PolicyAcknowledgementPage({
  params,
}: {
  params: Promise<{
    acknowledgementId: string;
  }>;
}) {
  const { acknowledgementId } =
    await params;

  const supabase =
    await createSupabaseServerClient();

  const {
    data: authData,
  } = await supabase.auth.getUser();

  if (!authData.user) {
    redirect("/login");
  }

  const {
    data: acknowledgement,
    error: acknowledgementError,
  } = await supabase
    .from("user_policy_acknowledgements")
    .select(
      "id,user_id,term_id,status,first_sent_at,viewed_at,approved_at"
    )
    .eq("id", acknowledgementId)
    .single();

  if (
    acknowledgementError ||
    !acknowledgement ||
    acknowledgement.user_id !==
      authData.user.id
  ) {
    notFound();
  }

  const {
    data: term,
    error: termError,
  } = await supabase
    .from("corporate_policy_terms")
    .select(
      "id,title,version,content_text,content_sha256,effective_at"
    )
    .eq("id", acknowledgement.term_id)
    .single();

  if (termError || !term) {
    notFound();
  }

  const {
    data: profile,
  } = await supabase
    .from("profiles")
    .select("name,email")
    .eq("id", authData.user.id)
    .single();

  const publicationDate =
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(
      new Date(term.effective_at)
    );

  const alreadyApproved =
    acknowledgement.status === "APROVADO";

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8">
      <PolicyViewTracker
        acknowledgementId={
          acknowledgementId
        }
      />

      <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border bg-white shadow-sm">

        <header className="bg-red-900 px-8 py-7 text-center text-white">
          <p className="text-2xl font-bold tracking-wide">
            AXION CONTROLE DE CONTRATOS - IA
          </p>
        </header>

        <div className="space-y-7 p-8">

          <div>
            <h1 className="text-2xl font-bold">
              {term.title}
            </h1>

            <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-600">
              <span>
                Versão:{" "}
                <strong>
                  {term.version}
                </strong>
              </span>

              <span>
                Publicação:{" "}
                <strong>
                  {publicationDate}
                </strong>
              </span>

              {profile?.email && (
                <span>
                  Usuário:{" "}
                  <strong>
                    {profile.email}
                  </strong>
                </span>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-slate-50 p-6">
            <div className="whitespace-pre-wrap text-[15px] leading-7 text-slate-900">
              {term.content_text}
            </div>
          </div>

          <div className="rounded-md bg-slate-50 p-4 text-xs text-slate-500">
            Identificação do documento:
            {" "}
            {term.content_sha256}
          </div>

          <PolicyApprovalForm
            acknowledgementId={
              acknowledgementId
            }
            alreadyApproved={
              alreadyApproved
            }
          />

        </div>
      </div>
    </main>
  );
}