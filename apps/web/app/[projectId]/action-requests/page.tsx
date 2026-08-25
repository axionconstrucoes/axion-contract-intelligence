import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { ActionRequestStatusBadge } from "@/components/shared/badges";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDateTime } from "@/lib/labels";
import { getActionRequests } from "@/lib/data";

export const metadata: Metadata = { title: "Solicitações" };

export default async function ActionRequestsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const actionRequests = await getActionRequests(projectId);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Solicitações" description="Solicitações rastreáveis para alguém analisar, responder ou executar algo." />

      {actionRequests.length === 0 ? (
        <EmptyState message="Nenhuma solicitação registrada para este projeto." />
      ) : (
        <div className="flex flex-col gap-2">
          {actionRequests.map((actionRequest) => (
            <Link
              key={actionRequest.id}
              href={`/${projectId}/action-requests/${actionRequest.id}`}
              className="flex flex-col gap-1 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">{actionRequest.title}</span>
                <ActionRequestStatusBadge status={actionRequest.status} />
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground">{actionRequest.description}</p>
              <span className="text-xs text-muted-foreground">
                Solicitada em {formatDateTime(actionRequest.requestedAt)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
