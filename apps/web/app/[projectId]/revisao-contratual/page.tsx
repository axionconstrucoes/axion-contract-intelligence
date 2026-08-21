import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  categoryLabels,
  formatDateTime,
} from "@/lib/labels";
import {
  getContractReviewCandidates,
  getCurrentProjectPermission,
} from "@/lib/contract-review";
import {
  reviewContractCandidateAction,
} from "./actions";

const priorityClasses:
  Record<string, string> = {
  CRITICA:
    "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  ALTA:
    "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  MEDIA:
    "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  BAIXA:
    "border-border bg-muted text-muted-foreground",
};

export default async function ContractReviewPage({
  params,
}: {
  params: Promise<{
    projectId: string;
  }>;
}) {
  const {
    projectId,
  } = await params;

  const [
    candidates,
    permission,
  ] = await Promise.all([
    getContractReviewCandidates(
      projectId
    ),
    getCurrentProjectPermission(
      projectId
    ),
  ]);

  const canReview =
    permission === "EDITOR" ||
    permission === "ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">
          RevisÃ£o Contratual
        </h1>

        <p className="text-sm text-muted-foreground">
          Candidatos detectados automaticamente a partir
          das comunicaÃ§Ãµes do projeto. Nenhum candidato
          entra no Event Ledger sem revisÃ£o humana.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">
              Pendentes
            </p>
            <p className="text-2xl font-semibold">
              {candidates.length}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">
              Sua permissÃ£o
            </p>
            <p className="text-lg font-semibold">
              {permission ?? "SEM ACESSO"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">
              Pode revisar
            </p>
            <p className="text-lg font-semibold">
              {canReview ? "Sim" : "NÃ£o"}
            </p>
          </CardContent>
        </Card>
      </div>

      {candidates.length === 0 ? (
        <EmptyState message="Nenhum candidato aguardando revisÃ£o." />
      ) : (
        <div className="flex flex-col gap-5">
          {candidates.map(
            (candidate) => (
              <Card key={candidate.id}>
                <CardHeader className="gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base">
                        {candidate.subject}
                      </CardTitle>

                      <p className="mt-1 text-xs text-muted-foreground">
                        Thread{" "}
                        {candidate.providerThreadId.slice(
                          0,
                          16
                        )}
                      </p>
                    </div>

                    <span
                      className={`rounded-md border px-2 py-1 text-xs font-semibold ${
                        priorityClasses[
                          candidate.priority
                        ] ??
                        priorityClasses.BAIXA
                      }`}
                    >
                      {candidate.priority}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {candidate.categories.map(
                      (category) => (
                        <span
                          key={category}
                          className="rounded-md border bg-muted px-2 py-1 text-xs"
                        >
                          {
                            categoryLabels[
                              category as keyof typeof categoryLabels
                            ] ?? category
                          }
                        </span>
                      )
                    )}
                  </div>
                </CardHeader>

                <CardContent className="flex flex-col gap-5">
                  <div className="grid gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Score
                      </p>
                      <p className="font-medium">
                        {candidate.score}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground">
                        Mensagens
                      </p>
                      <p className="font-medium">
                        {
                          candidate.messageCount
                        }
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground">
                        InÃ­cio
                      </p>
                      <p className="font-medium">
                        {formatDateTime(
                          candidate.firstMessageAt
                        )}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground">
                        Ãšltima mensagem
                      </p>
                      <p className="font-medium">
                        {formatDateTime(
                          candidate.lastMessageAt
                        )}
                      </p>
                    </div>
                  </div>

                  <details className="rounded-md border">
                    <summary className="cursor-pointer p-3 text-sm font-medium">
                      Ver evidÃªncias (
                      {
                        candidate.evidence
                          .length
                      }
                      )
                    </summary>

                    <div className="flex flex-col gap-3 border-t p-3">
                      {candidate.evidence.map(
                        (
                          evidence,
                          index
                        ) => (
                          <div
                            key={
                              evidence.id
                            }
                            className="rounded-md bg-muted/50 p-3"
                          >
                            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>
                                #
                                {index +
                                  1}
                              </span>

                              <span>
                                {formatDateTime(
                                  evidence.sentAt
                                )}
                              </span>

                              <span>
                                {evidence.direction ??
                                  "â€”"}
                              </span>
                            </div>

                            <p className="text-sm font-medium">
                              {evidence.subject ??
                                "(sem assunto)"}
                            </p>

                            <p className="mt-1 text-xs text-muted-foreground">
                              De:{" "}
                              {evidence.fromAddress ??
                                "â€”"}
                            </p>

                            <p className="text-xs text-muted-foreground">
                              Para:{" "}
                              {evidence.toAddress ??
                                "â€”"}
                            </p>

                            {evidence.snippet ? (
                              <p className="mt-2 text-sm leading-relaxed">
                                {
                                  evidence.snippet
                                }
                              </p>
                            ) : null}
                          </div>
                        )
                      )}
                    </div>
                  </details>

                  {canReview ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <form
                        action={
                          reviewContractCandidateAction
                        }
                        className="flex flex-col gap-3 rounded-md border p-4"
                      >
                        <input
                          type="hidden"
                          name="candidateId"
                          value={
                            candidate.id
                          }
                        />

                        <input
                          type="hidden"
                          name="decision"
                          value="APPROVE"
                        />

                        <div>
                          <label className="text-sm font-medium">
                            TÃ­tulo do evento
                          </label>

                          <input
                            name="eventTitle"
                            required
                            defaultValue={
                              candidate.subject
                            }
                            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                          />
                        </div>

                        <div>
                          <label className="text-sm font-medium">
                            ConclusÃ£o do revisor
                          </label>

                          <textarea
                            name="eventDescription"
                            required
                            rows={5}
                            placeholder="Descreva o fato contratual confirmado, sua relevÃ¢ncia e o entendimento do revisor."
                            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                          />
                        </div>

                        <Button
                          type="submit"
                        >
                          Aprovar como evento
                        </Button>
                      </form>

                      <form
                        action={
                          reviewContractCandidateAction
                        }
                        className="flex flex-col gap-3 rounded-md border p-4"
                      >
                        <input
                          type="hidden"
                          name="candidateId"
                          value={
                            candidate.id
                          }
                        />

                        <input
                          type="hidden"
                          name="decision"
                          value="REJECT"
                        />

                        <div>
                          <label className="text-sm font-medium">
                            Justificativa da rejeiÃ§Ã£o
                          </label>

                          <textarea
                            name="reviewNote"
                            required
                            rows={5}
                            placeholder="Explique por que este candidato nÃ£o deve ser tratado como evento contratual."
                            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                          />
                        </div>

                        <Button
                          type="submit"
                          variant="outline"
                          className="border-destructive text-destructive hover:bg-destructive/10"
                        >
                          Rejeitar candidato
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <p className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">
                      VocÃª possui acesso de leitura.
                      AprovaÃ§Ã£o ou rejeiÃ§Ã£o exige
                      permissÃ£o EDITOR ou ADMIN.
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          )}
        </div>
      )}
    </div>
  );
}
