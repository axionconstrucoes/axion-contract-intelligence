import { TimelinePageClient } from "@/components/timeline/timeline-page-client";
import { getEvents } from "@/lib/data";

export default async function TimelinePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const events = getEvents(projectId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Timeline</h1>
        <p className="text-sm text-muted-foreground">Linha do tempo cronológica de todos os eventos consolidados.</p>
      </div>
      <TimelinePageClient events={events} projectId={projectId} />
    </div>
  );
}
