import { useMemo, useState } from "react";
import { useListPagosSuscripcion } from "@workspace/api-client-react";
import type { ListPagosSuscripcionParams, PagoSuscripcion } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { formatCurrency } from "@/lib/format";
import { Download, X } from "lucide-react";
import * as XLSX from "xlsx";

type EstadoFilter = NonNullable<ListPagosSuscripcionParams["estado"]>;

const ESTADOS: { value: EstadoFilter; label: string }[] = [
  { value: "pagado", label: "Pagado" },
  { value: "pendiente", label: "Pendiente" },
  { value: "fallido", label: "Fallido" },
];

function EstadoBadge({ estado }: { estado: PagoSuscripcion["estado"] }) {
  if (estado === "pagado")
    return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border border-emerald-200">Pagado</Badge>;
  if (estado === "pendiente")
    return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border border-amber-200">Pendiente</Badge>;
  return <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border border-red-200">Fallido</Badge>;
}

function formatFecha(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Registro de pagos de suscripciones de la plataforma (libro de ingresos de
// NextCob SpA). Reemplaza el módulo de cobros para la cuenta superadmin.
export default function SuscripcionesRegistro() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [estado, setEstado] = useState<EstadoFilter | "todos">("todos");

  const params: ListPagosSuscripcionParams = {};
  if (desde) params.desde = desde;
  if (hasta) params.hasta = hasta;
  if (estado !== "todos") params.estado = estado;

  const { data: pagos, isLoading } = useListPagosSuscripcion(params);

  const totales = useMemo(() => {
    const pagados = (pagos ?? []).filter((p) => p.estado === "pagado");
    return {
      cantidad: pagados.length,
      neto: pagados.reduce((s, p) => s + p.montoNeto, 0),
      iva: pagados.reduce((s, p) => s + p.montoIva, 0),
      total: pagados.reduce((s, p) => s + p.montoTotal, 0),
    };
  }, [pagos]);

  const exportarExcel = () => {
    const rows = (pagos ?? []).map((p) => ({
      "Fecha del pago": formatFecha(p.fecha),
      "ID de cuenta": p.accountId ?? "",
      Cliente: p.clienteNombre ?? "",
      Email: p.clienteEmail ?? "",
      Plan: p.plan,
      Detalle: p.detalle,
      "Usuarios extra": p.usuariosAdicionales,
      "Monto neto (CLP)": p.montoNeto,
      "IVA 19% (CLP)": p.montoIva,
      "Monto total (CLP)": p.montoTotal,
      Estado: p.estado,
      "Método de pago": p.metodo,
      "Período hasta": p.periodoHasta ? formatFecha(p.periodoHasta) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 14 }, { wch: 16 }, { wch: 28 }, { wch: 28 }, { wch: 18 },
      { wch: 26 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 16 },
      { wch: 10 }, { wch: 14 }, { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pagos suscripciones");
    const fecha = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `registro-suscripciones-nextcob-${fecha}.xlsx`);
  };

  const hayFiltros = desde || hasta || estado !== "todos";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Registro de suscripciones</h1>
          <p className="text-sm text-muted-foreground">
            Libro de ingresos de NextCob SpA — pagos de suscripción de todos los clientes de la plataforma.
          </p>
        </div>
        <Button onClick={exportarExcel} disabled={!pagos?.length} data-testid="button-exportar-excel">
          <Download className="h-4 w-4 mr-2" />
          Exportar a Excel
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Pagos registrados</p>
          <p className="text-xl font-bold" data-testid="text-total-pagos">{totales.cantidad}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Ingresos netos</p>
          <p className="text-xl font-bold">{formatCurrency(totales.neto)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">IVA (19%)</p>
          <p className="text-xl font-bold">{formatCurrency(totales.iva)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total cobrado</p>
          <p className="text-xl font-bold">{formatCurrency(totales.total)}</p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Desde</label>
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" data-testid="input-desde" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Hasta</label>
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" data-testid="input-hasta" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Estado</label>
            <Select value={estado} onValueChange={(v) => setEstado(v as EstadoFilter | "todos")}>
              <SelectTrigger className="w-40" data-testid="select-estado">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {ESTADOS.map((e) => (
                  <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hayFiltros && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setDesde(""); setHasta(""); setEstado("todos"); }}
              data-testid="button-limpiar-filtros"
            >
              <X className="h-4 w-4 mr-1" />
              Limpiar
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>ID de cuenta</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Detalle</TableHead>
              <TableHead className="text-right">Neto</TableHead>
              <TableHead className="text-right">IVA</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Método</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  Cargando…
                </TableCell>
              </TableRow>
            ) : !pagos?.length ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8" data-testid="text-sin-pagos">
                  Aún no hay pagos de suscripción registrados. Cuando Fintoc esté integrado, cada cargo mensual aparecerá aquí automáticamente.
                </TableCell>
              </TableRow>
            ) : (
              pagos.map((p) => (
                <TableRow key={p.id} data-testid={`row-pago-${p.id}`}>
                  <TableCell>{formatFecha(p.fecha)}</TableCell>
                  <TableCell className="font-mono text-xs">{p.accountId ?? "—"}</TableCell>
                  <TableCell>
                    <div className="font-medium">{p.clienteNombre ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{p.clienteEmail ?? ""}</div>
                  </TableCell>
                  <TableCell className="capitalize">{p.plan}</TableCell>
                  <TableCell className="text-sm">{p.detalle}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.montoNeto)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(p.montoIva)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(p.montoTotal)}</TableCell>
                  <TableCell><EstadoBadge estado={p.estado} /></TableCell>
                  <TableCell className="capitalize">{p.metodo}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
