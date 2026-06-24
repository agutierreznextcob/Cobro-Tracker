import { useState } from "react";
import {
  useListLeads,
  useActualizarLeadEstado,
  getListLeadsQueryKey,
  getContarLeadsNuevosQueryKey,
  LeadEstadoInputEstado,
  type ListLeadsParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Mail, Phone, UserPlus } from "lucide-react";

type Estado = (typeof LeadEstadoInputEstado)[keyof typeof LeadEstadoInputEstado];

const ESTADO_LABEL: Record<Estado, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  en_proceso: "En proceso",
  cerrado: "Cerrado",
  descartado: "Descartado",
};

const ESTADO_BADGE: Record<Estado, string> = {
  nuevo: "bg-primary/15 text-primary border-primary/30",
  contactado: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  en_proceso: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  cerrado: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  descartado: "bg-muted text-muted-foreground border-border",
};

const ESTADOS: Estado[] = ["nuevo", "contactado", "en_proceso", "cerrado", "descartado"];

function formatFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LeadsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filtro, setFiltro] = useState<"todos" | Estado>("todos");

  const params: ListLeadsParams | undefined =
    filtro === "todos" ? undefined : { estado: filtro };

  const { data: leads, isLoading } = useListLeads(params, {
    query: { queryKey: getListLeadsQueryKey(params) },
  });

  const actualizar = useActualizarLeadEstado();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getContarLeadsNuevosQueryKey() });
  };

  const cambiarEstado = (id: number, estado: Estado) => {
    actualizar.mutate(
      { id, data: { estado } },
      {
        onSuccess: () => {
          toast({ title: "Estado actualizado", description: `Lead marcado como ${ESTADO_LABEL[estado]}.` });
          invalidate();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo actualizar el estado.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  };

  const pendingId =
    actualizar.isPending && actualizar.variables ? actualizar.variables.id : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Solicitudes de presentación recibidas desde la landing.
          </p>
        </div>
        <div className="w-full sm:w-56">
          <Select value={filtro} onValueChange={(v) => setFiltro(v as "todos" | Estado)}>
            <SelectTrigger>
              <SelectValue placeholder="Filtrar por estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              {ESTADOS.map((e) => (
                <SelectItem key={e} value={e}>
                  {ESTADO_LABEL[e]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {leads ? `${leads.length} lead${leads.length === 1 ? "" : "s"}` : "Leads"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !leads || leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <UserPlus className="h-8 w-8 mb-3 opacity-40" />
              <p className="text-sm">No hay leads para este filtro.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Teléfono</TableHead>
                    <TableHead>Correo</TableHead>
                    <TableHead>Mensaje</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => {
                    const estado = lead.estado as Estado;
                    const isRowPending = pendingId === lead.id;
                    return (
                      <TableRow key={lead.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatFecha(lead.creadoEn)}
                        </TableCell>
                        <TableCell className="font-medium">{lead.nombre}</TableCell>
                        <TableCell>
                          <a
                            href={`tel:${lead.telefono}`}
                            className="inline-flex items-center gap-1.5 text-sm hover:text-primary transition-colors"
                          >
                            <Phone className="h-3.5 w-3.5 opacity-60" />
                            {lead.telefono}
                          </a>
                        </TableCell>
                        <TableCell>
                          <a
                            href={`mailto:${lead.email}`}
                            className="inline-flex items-center gap-1.5 text-sm hover:text-primary transition-colors"
                          >
                            <Mail className="h-3.5 w-3.5 opacity-60" />
                            {lead.email}
                          </a>
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <span className="block truncate text-sm text-muted-foreground" title={lead.mensaje ?? ""}>
                            {lead.mensaje || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={estado}
                            onValueChange={(v) => cambiarEstado(lead.id, v as Estado)}
                            disabled={isRowPending}
                          >
                            <SelectTrigger className="h-8 w-[140px]">
                              <Badge
                                variant="outline"
                                className={`border ${ESTADO_BADGE[estado]} font-medium`}
                              >
                                {ESTADO_LABEL[estado]}
                              </Badge>
                            </SelectTrigger>
                            <SelectContent>
                              {ESTADOS.map((e) => (
                                <SelectItem key={e} value={e}>
                                  {ESTADO_LABEL[e]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          {estado === "nuevo" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isRowPending}
                              onClick={() => cambiarEstado(lead.id, "contactado")}
                            >
                              {isRowPending ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                "Contactado"
                              )}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
