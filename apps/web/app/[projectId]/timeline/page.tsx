import type { Metadata } from "next";
import { createSupabaseServerClient } from "@axion/db/server";

import { PageHeader } from "@/components/layout/page-header";
import { TimelinePageClient } from "@/components/timeline/timeline-page-client";
import { getEmails, getEvents, getProject } from "@/lib/data";
import { getEventNotesForProject } from "@/lib/event-notes";
import { getManagedDocuments } from "@/lib/document-management";
import type {
  TimelineDocumentContext,
  TimelineEmailContext,
  TimelineEventNoteContext,
} from "@/lib/timeline-export/types";

export const metadata: Metadata = { title: "Timeline" };

export default async function TimelinePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const [project, events, emails, managedDocuments, eventNotes] = await Promise.all([
    getProject(projectId),
    getEvents(projectId),
    getEmails(projectId),
    getManagedDocuments(projectId),
    getEventNotesForProject(projectId),
  ]);

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  let exportedByName = "Usuário não disponível";
  if (authData.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", authData.user.id)
      .maybeSingle();
    exportedByName = (profile as { name: string } | null)?.name ?? authData.user.email ?? exportedByName;
  }

  // Passadas como arrays de entradas (não Map) na fronteira server→client:
  // reconstruídas em Map no client component, evitando depender da
  // serialização nativa de Map/Set do RSC.
  const emailEntries: Array<[string, TimelineEmailContext]> = emails.map((email) => [
    email.id,
    {
      emailId: email.id,
      from: email.from,
      to: email.to,
      subject: email.subject,
      sentAt: email.date,
      snippet: email.snippet,
    },
  ]);

  const documentVersionEntries: Array<[string, TimelineDocumentContext]> = [];
  for (const document of managedDocuments) {
    for (const version of document.versions) {
      documentVersionEntries.push([
        version.id,
        {
          documentVersionId: version.id,
          documentTitle: document.title,
          filePath: version.filePath,
          storageBucket: version.storageBucket,
          originalFileName: version.originalFileName,
          mimeType: version.mimeType,
        },
      ]);
    }
  }

  const eventNotesByEventIdMap = new Map<string, TimelineEventNoteContext[]>();
  for (const note of eventNotes) {
    const list = eventNotesByEventIdMap.get(note.eventId) ?? [];
    list.push({
      id: note.id,
      category: note.category,
      text: note.text,
      authorName: note.authorName,
      createdAt: note.createdAt,
    });
    eventNotesByEventIdMap.set(note.eventId, list);
  }
  const eventNoteEntries: Array<[string, TimelineEventNoteContext[]]> = Array.from(eventNotesByEventIdMap.entries());

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Timeline" description="Linha do tempo cronológica de todos os eventos consolidados." />
      <TimelinePageClient
        events={events}
        projectId={projectId}
        projectName={project?.name ?? "Projeto não disponível"}
        emailEntries={emailEntries}
        documentVersionEntries={documentVersionEntries}
        eventNoteEntries={eventNoteEntries}
        exportedByUserId={authData.user?.id ?? ""}
        exportedByName={exportedByName}
      />
    </div>
  );
}
