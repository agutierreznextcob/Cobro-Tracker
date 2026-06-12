import { useGetCobro, getGetCobroQueryKey, useUpdateCobro, getListCobrosQueryKey, getGetCobrosSummaryQueryKey } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { ArrowLeft, RefreshCw, Calendar, FileText, Hash, Wallet } from "lucide-react";
import { CobroUpdateEstado } from "@workspace/api-client-react";

export default function CobroDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0", 10);
  
  const { data: cobro, isLoading } = useGetCobro(id, { query: { enabled: !!id, queryKey: getGetCobroQueryKey(id) } });
  const updateCobro = useUpdateCobro();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleStatusChange = (newStatus: string) => {
    updateCobro.mutate({
      id,
      data: { estado: newStatus as CobroUpdateEstado }
    }, {
      onSuccess: () => {
        toast({ title: "Status updated", description: `Cobro marked as ${newStatus}.` });
        queryClient.invalidateQueries({ queryKey: getGetCobroQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListCobrosQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCobrosSummaryQueryKey() });
      },
      onError: () => {
        toast({ title: "Update failed", description: "Could not update status.", variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="h-6 w-32 bg-muted rounded animate-pulse" />
        <Card className="animate-pulse">
          <CardHeader className="h-20 bg-muted/50 border-b border-border/50" />
          <CardContent className="h-64 bg-muted/20" />
        </Card>
      </div>
    );
  }

  if (!cobro) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20">
        <h2 className="text-2xl font-bold mb-2">Cobro Not Found</h2>
        <p className="text-muted-foreground mb-6">The charge you're looking for doesn't exist or was deleted.</p>
        <Link href="/">
          <Button variant="outline"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-300">
      <Link href="/" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-2 transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Dashboard
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cobro #{cobro.id}</h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-2">
            Created on {formatDate(cobro.creadoEn)}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="bg-card border rounded-md px-3 py-1.5 shadow-sm flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Status:</span>
            <Select 
              value={cobro.estado} 
              onValueChange={handleStatusChange}
              disabled={updateCobro.isPending}
            >
              <SelectTrigger className="w-[140px] h-8 border-0 bg-transparent p-0 focus:ring-0 [&>span]:flex [&>span]:items-center [&>span]:gap-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CobroUpdateEstado.pendiente}>Pendiente</SelectItem>
                <SelectItem value={CobroUpdateEstado.pagado}>Pagado</SelectItem>
                <SelectItem value={CobroUpdateEstado.fallido}>Fallido</SelectItem>
                <SelectItem value={CobroUpdateEstado.cancelado}>Cancelado</SelectItem>
              </SelectContent>
            </Select>
            {updateCobro.isPending && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground ml-2" />}
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2 shadow-sm border-border/50">
          <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Details
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Description</p>
              <p className="text-base">{cobro.descripcion}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-6 pt-4 border-t border-border/50">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5" /> Reference
                </p>
                <p className="font-mono text-sm">{cobro.referencia || "Not provided"}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> Last Updated
                </p>
                <p className="text-sm">{cobro.actualizadoEn ? formatDate(cobro.actualizadoEn) : "Never"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-primary/20 bg-primary/5 h-fit">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" />
              Amount
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold font-mono text-primary tracking-tight">
              {formatCurrency(cobro.monto)}
            </div>
            <div className="mt-6 pt-6 border-t border-primary/10">
              <StatusBadge status={cobro.estado} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
