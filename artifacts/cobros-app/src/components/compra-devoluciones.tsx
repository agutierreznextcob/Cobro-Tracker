import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListDevolucionesCompra, getListDevolucionesCompraQueryKey, useDevolverCompra, type Compra } from "@workspace/api-client-react";
import { itemsDe, invalidateCompras } from "@/lib/compras";
import { apiErrorMessage, formatQty } from "@/lib/inventario";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CompraDevoluciones({ compra }: { compra: Compra }) {
  const qc = useQueryClient();
  const q = useListDevolucionesCompra(compra.id, { query: { queryKey: getListDevolucionesCompraQueryKey(compra.id), staleTime: 0, refetchInterval: 30000 } });
  const mutation = useDevolverCompra();
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  // Retain the exact submitted request after a network error; retries cannot become a new return.
  const pending = useRef<{ clave: string; motivo: string; items: { itemId: number; cantidad: number }[] } | null>(null);
  const lines = itemsDe(compra).filter(i => i.productoId && i.bodegaDestinoId);
  const remaining = (id: number, received: number) => Math.round((received - (q.data ?? []).filter(r => r.itemId === id).reduce((n, r) => n + r.cantidad, 0)) * 1000) / 1000;
  async function submit() {
    setError("");
    if (!pending.current && lines.some(i => {
      const n = Number(amounts[i.id] || 0);
      return !Number.isFinite(n) || n < 0 || n > remaining(i.id, i.cantidad) || Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-5;
    })) { setError("Revisa las cantidades: entre cero y lo retornable, con máximo 3 decimales."); return; }
    const data = pending.current ?? { clave: crypto.randomUUID(), motivo: motivo.trim(), items: lines
      .filter(i => Number(amounts[i.id]) > 0).map(i => ({ itemId: i.id, cantidad: Number(amounts[i.id]) })) };
    if (!data.items.length || !data.motivo) { setError("Indica cantidades y un motivo."); return; }
    pending.current = data;
    try {
      await mutation.mutateAsync({ id: compra.id, data });
      pending.current = null; setOpen(false); setAmounts({}); setMotivo("");
      invalidateCompras(qc, true);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status && status >= 400 && status < 500) pending.current = null;
      setError(apiErrorMessage(err, "No se pudo confirmar. Reintenta la misma devolución para evitar duplicados."));
      void q.refetch();
    }
  }
  return <Card>
    <CardHeader><CardTitle className="text-base">Devoluciones al proveedor</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">La salida se registra en la bodega original de recepción. No modifica la factura ni los costos, y no genera reembolsos.</p>
      {q.isLoading ? <p>Cargando devoluciones…</p> : q.isError ? <Button variant="outline" onClick={() => q.refetch()}>Reintentar carga del histórico</Button> : <>
        {lines.map(i => <p className="text-sm" key={i.id}>{i.descripcion} · Bodega #{i.bodegaDestinoId}: recibido {formatQty(i.cantidad)} · retornable {formatQty(remaining(i.id, i.cantidad))}</p>)}
        {compra.puedeRecibir && !open && lines.some(i => remaining(i.id, i.cantidad) > 0) &&
          <Button variant="outline" onClick={() => { setOpen(true); setAmounts({}); setMotivo(""); setError(""); }}>Registrar devolución</Button>}
        {open && <div className="space-y-3 border rounded-md p-4">
          <p className="text-sm font-medium">Devolución parcial o total</p>
          <Button variant="outline" size="sm" disabled={mutation.isPending || !!pending.current} onClick={() => setAmounts(Object.fromEntries(lines.map(i => [i.id, String(Math.max(0, remaining(i.id, i.cantidad)))])))}>Devolver todo lo retornable</Button>
          {lines.map(i => <label className="block text-sm" key={i.id}>{i.descripcion} · Bodega #{i.bodegaDestinoId}
            <Input aria-label={`Cantidad a devolver ${i.descripcion}`} type="number" min="0" max={remaining(i.id, i.cantidad)} step="0.001" value={amounts[i.id] ?? ""} disabled={mutation.isPending || !!pending.current}
              onChange={e => setAmounts({ ...amounts, [i.id]: e.target.value })} />
          </label>)}
          <label className="block text-sm">Motivo<Input value={motivo} maxLength={500} disabled={mutation.isPending || !!pending.current} onChange={e => setMotivo(e.target.value)} /></label>
          <p className="text-xs text-muted-foreground">Confirma solo si los productos salen físicamente hacia el proveedor. El registro no se puede editar ni eliminar.</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button disabled={mutation.isPending} onClick={submit}>{mutation.isPending ? "Registrando…" : pending.current ? "Reintentar confirmación" : "Confirmar devolución"}</Button>
            <Button variant="outline" disabled={mutation.isPending || !!pending.current} onClick={() => setOpen(false)}>Cancelar</Button>
          </div>
        </div>}
        <h3 className="text-sm font-semibold">Histórico de salidas</h3>
        {!q.data?.length && <p className="text-sm text-muted-foreground">Sin devoluciones registradas.</p>}
        {q.data?.map(r => <div key={r.id} className="border-t pt-2 text-sm">
          <p>{lines.find(i => i.id === r.itemId)?.descripcion ?? `Ítem #${r.itemId}`} · {formatQty(r.cantidad)} unidades · Bodega #{r.bodegaId}</p>
          <p>{r.motivo}</p><p className="text-xs text-muted-foreground">{new Date(r.creadoEn).toLocaleString("es-CL")} · Usuario {r.usuarioId} · Movimiento #{r.id}</p>
        </div>)}
      </>}
    </CardContent>
  </Card>;
}
