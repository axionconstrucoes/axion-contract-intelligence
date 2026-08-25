import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { EventTable } from "@/components/ledger/event-table";
import { EmptyState } from "@/components/shared/empty-state";
import { getEvents } from "@/lib/data";

export const metadata: Metadata = { title: "Event Ledger" };

export default async function LedgerPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const events = await getEvents(projectId);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Event Ledger" description="Registro cronológico de eventos com possível implicação contratual." />
      {events.length === 0 ? <EmptyState message="Nenhum evento registrado." /> : <EventTable events={events} projectId={projectId} />}
    </div>
  );
}
