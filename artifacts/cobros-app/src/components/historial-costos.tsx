import { Link } from "wouter";
import { useListHistorialCostos, getListHistorialCostosQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { ArrowRight, History, RotateCw } from "lucide-react";

const fechaFmt = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("es-CL", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function HistorialCostos({ productoId }: { productoId: number }) {
  const q = useListHistorialCostos(productoId, {
    query: { queryKey: getListHistorialCostosQueryKey(productoId), enabled: !!productoId, staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true },
  });
  const rows = q.data ?? [];

  return (
    <Card className="min-w-0 w-full shadow-sm" data-testid="card-historial-costos">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4 text-primary" />Historial de costos</CardTitle>
        <CardDescription>Cada cambio de costo neto, manual o desde una factura de compra.</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-9 rounded bg-muted animate-pulse" />)}</div>
        ) : q.isError ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-center justify-between gap-2">
            <span>No se pudo cargar el historial.</span>
            <Button size="sm" variant="outline" onClick={() => q.refetch()} data-testid="button-reintentar-historial"><RotateCw className="h-3.5 w-3.5 mr-1.5" />Reintentar</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-5 text-center">
            <p className="text-sm font-medium">Sin cambios de costo todavía</p>
            <p className="text-xs text-muted-foreground mt-1">Al editar el costo o recibir una compra con otro costo, quedará registrado aquí.</p>
          </div>
        ) : (
          <div className="max-w-full overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                  <th className="text-left font-medium py-2 px-1">Fecha</th>
                  <th className="text-right font-medium py-2 px-1">Costo anterior</th>
                  <th className="w-6" />
                  <th className="text-right font-medium py-2 px-1">Costo nuevo</th>
                  <th className="text-left font-medium py-2 px-1 pl-4">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((h) => {
                  const fmt = (n: number) => formatMoney(n, h.moneda, h.decimales);
                  const sube = h.costoAnterior != null && h.costoNuevo > h.costoAnterior;
                  return (
                    <tr key={h.id} data-testid={`row-historial-costo-${h.id}`}>
                      <td className="py-2 px-1 whitespace-nowrap text-muted-foreground">{fechaFmt(h.fecha)}</td>
                      <td className="py-2 px-1 text-right font-mono tabular-nums text-muted-foreground">{h.costoAnterior != null ? fmt(h.costoAnterior) : "—"}</td>
                      <td className="text-center"><ArrowRight className="inline h-3 w-3 text-muted-foreground" /></td>
                      <td className={`py-2 px-1 text-right font-mono tabular-nums font-semibold ${h.costoAnterior == null ? "" : sube ? "text-red-600" : "text-emerald-700"}`}>{fmt(h.costoNuevo)}</td>
                      <td className="py-2 px-1 pl-4 whitespace-nowrap">
                        {h.origen === "compra" && h.compraId ? (
                          <Link href={`/compras/${h.compraId}`} className="text-primary hover:underline" data-testid={`link-historial-compra-${h.id}`}>Compra Nº {h.numeroFactura ?? h.compraId}</Link>
                        ) : h.origen === "compra" ? `Compra Nº ${h.numeroFactura ?? "—"}` : "Manual"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
