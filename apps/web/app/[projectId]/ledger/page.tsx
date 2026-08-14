import { EventTable } from "@/components/ledger/event-table";
import { EmptyState } from "@/components/shared/empty-state";
import { getEvents } from "@/lib/data";

export default async function LedgerPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const events = getEvents(projectId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Event Ledger</h1>
        <p className="text-sm text-muted-foreground">Registro cronológico de eventos com possível implicação contratual.</p>
      </div>
      {events.length === 0 ? <EmptyState message="Nenhum evento registrado." /> : <EventTable events={events} projectId={projectId} />}
    </div>
  );
}
