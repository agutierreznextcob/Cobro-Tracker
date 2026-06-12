import { Badge } from "@/components/ui/badge";
import { CobroEstado } from "@workspace/api-client-react";
import { CheckCircle2, Clock, XCircle, Ban } from "lucide-react";

export function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case CobroEstado.pagado:
      return (
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900 gap-1.5 font-medium py-1">
          <CheckCircle2 className="h-3 w-3" />
          Paid
        </Badge>
      );
    case CobroEstado.pendiente:
      return (
        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900 gap-1.5 font-medium py-1">
          <Clock className="h-3 w-3" />
          Pending
        </Badge>
      );
    case CobroEstado.fallido:
      return (
        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1.5 font-medium py-1">
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      );
    case CobroEstado.cancelado:
      return (
        <Badge variant="outline" className="bg-muted text-muted-foreground border-border gap-1.5 font-medium py-1">
          <Ban className="h-3 w-3" />
          Cancelled
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
