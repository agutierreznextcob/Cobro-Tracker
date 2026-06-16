import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useListCobros } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatShortDate } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { ArrowRight, Minus, X } from "lucide-react";
import type { ListCobrosParams } from "@workspace/api-client-react";

type EstadoFilter = ListCobrosParams["estado"];
type MetodoFilter = ListCobrosParams["metodo"];

function MetodoBadge({ flowLinkPago, mpPaymentLinkUrl }: { flowLinkPago?: string | null; mpPaymentLinkUrl?: string | null }) {
  if (flowLinkPago && mpPaymentLinkUrl) {
    return (
      <div className="flex items-center gap-1">
        <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-semibold leading-none border border-blue-200">Flow</span>
        <span className="inline-flex items-center rounded-full bg-[#009ee3]/10 text-[#009ee3] px-2 py-0.5 text-[10px] font-semibold leading-none border border-[#009ee3]/30">MP</span>
      </div>
    );
  }
  if (flowLinkPago) {
    return <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-semibold leading-none border border-blue-200">Flow</span>;
  }
  if (mpPaymentLinkUrl) {
    return <span className="inline-flex items-center rounded-full bg-[#009ee3]/10 text-[#009ee3] px-2 py-0.5 text-[10px] font-semibold leading-none border border-[#009ee3]/30">MP</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-[10px] font-semibold leading-none border border-amber-200">
      <Minus className="h-2.5 w-2.5" />
      Manual
    </span>
  );
}

const ESTADOS: { value: NonNullable<EstadoFilter>; label: string }[] = [
  { value: "pendiente", label: "Pendiente" },
  { value: "pagado", label: "Pagado" },
  { value: "parcial", label: "Parcial" },
  { value: "fallido", label: "Fallido" },
  { value: "cancelado", label: "Cancelado" },
];

const METODOS: { value: NonNullable<MetodoFilter>; label: string }[] = [
  { value: "link", label: "Pasarela de pago" },
  { value: "flow", label: "Solo Flow" },
  { value: "mp", label: "Solo MercadoPago" },
  { value: "manual", label: "Manual / Interno" },
];

export default function CobrosList() {
  const [filterEstado, setFilterEstado] = useState<EstadoFilter>(undefined);
  const [filterMetodo, setFilterMetodo] = useState<MetodoFilter>(undefined);
  const [, navigate] = useLocation();

  const params: ListCobrosParams = {};
  if (filterEstado) params.estado = filterEstado;
  if (filterMetodo) params.metodo = filterMetodo;

  const { data: cobros, isLoading } = useListCobros(params, {
    query: { queryKey: ["listCobros", params] as const },
  });

  const hayFiltros = !!filterEstado || !!filterMetodo;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cobros</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLoading ? "Cargando..." : `${cobros?.length ?? 0} cobro${cobros?.length !== 1 ? "s" : ""}`}
            {hayFiltros ? " (con filtros)" : ""}
          </p>
        </div>
        <Link href="/cobros/nuevo">
          <Button size="sm">+ Nuevo cobro</Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select
          value={filterEstado ?? ""}
          onValueChange={(v) => setFilterEstado(v ? (v as NonNullable<EstadoFilter>) : undefined)}
        >
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder="Estado: todos" />
          </SelectTrigger>
          <SelectContent>
            {ESTADOS.map((e) => (
              <SelectItem key={e.value} value={e.value} className="text-xs">
                {e.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filterMetodo ?? ""}
          onValueChange={(v) => setFilterMetodo(v ? (v as NonNullable<MetodoFilter>) : undefined)}
        >
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue placeholder="Método: todos" />
          </SelectTrigger>
          <SelectContent>
            {METODOS.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hayFiltros && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            onClick={() => { setFilterEstado(undefined); setFilterMetodo(undefined); }}
          >
            <X className="h-3 w-3" />
            Limpiar
          </Button>
        )}
      </div>

      {/* Table */}
      <Card className="shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-xs">Fecha</TableHead>
              <TableHead className="text-xs">Descripción</TableHead>
              <TableHead className="text-xs">Cliente</TableHead>
              <TableHead className="text-xs">Estado</TableHead>
              <TableHead className="text-xs">Método</TableHead>
              <TableHead className="text-xs text-right">Monto</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [1, 2, 3, 4, 5, 6].map((i) => (
                <TableRow key={i} className="animate-pulse">
                  <TableCell><div className="h-4 w-20 bg-muted rounded" /></TableCell>
                  <TableCell><div className="h-4 w-48 bg-muted rounded" /></TableCell>
                  <TableCell><div className="h-4 w-28 bg-muted rounded" /></TableCell>
                  <TableCell><div className="h-5 w-20 bg-muted rounded-full" /></TableCell>
                  <TableCell><div className="h-5 w-16 bg-muted rounded-full" /></TableCell>
                  <TableCell><div className="h-4 w-16 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell />
                </TableRow>
              ))
            ) : !cobros || cobros.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground text-sm">
                  {hayFiltros ? "Ningún cobro coincide con los filtros." : "Sin cobros registrados."}
                </TableCell>
              </TableRow>
            ) : (
              cobros.map((cobro) => (
                <TableRow
                  key={cobro.id}
                  className="cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => navigate(`/cobros/${cobro.id}`)}
                >
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatShortDate(cobro.creadoEn)}
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <div className="text-sm font-medium truncate">{cobro.descripcion}</div>
                    {cobro.referencia && (
                      <div className="text-[10px] text-muted-foreground/60 font-mono truncate">{cobro.referencia}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {cobro.clienteNombre ?? cobro.responsableNombre ?? <span className="opacity-40">—</span>}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={cobro.estado} />
                  </TableCell>
                  <TableCell>
                    <MetodoBadge flowLinkPago={cobro.flowLinkPago} mpPaymentLinkUrl={cobro.mpPaymentLinkUrl} />
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold text-sm whitespace-nowrap">
                    {formatCurrency(cobro.monto)}
                  </TableCell>
                  <TableCell>
                    <ArrowRight className="h-4 w-4 text-muted-foreground/40" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
