import type { Alert } from "@axion/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryBadge, SeverityBadge } from "@/components/shared/badges";
import { formatDateTime } from "@/lib/labels";

// TEMPORARY: Alerts still use mock event IDs. Restore event navigation when
// Alerts are migrated to real contract_event UUIDs.
export function AlertCard({ alert }: { alert: Alert; projectId: string }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <CardTitle>{alert.title}</CardTitle>
        <SeverityBadge severity={alert.severity} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        <p className="text-sm text-muted-foreground">{alert.description}</p>
        <div className="flex items-center gap-2">
          <CategoryBadge category={alert.category} />
          <span className="text-xs text-muted-foreground">{formatDateTime(alert.createdAt)}</span>
          {!alert.acknowledged && <span className="text-xs font-medium text-severity-alta">Não reconhecido</span>}
        </div>
      </CardContent>
    </Card>
  );
}
