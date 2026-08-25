import { Inbox } from "lucide-react";

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border p-7 text-center text-sm text-muted-foreground">
      <Inbox className="size-5 text-muted-foreground/50" aria-hidden="true" />
      {message}
    </div>
  );
}
