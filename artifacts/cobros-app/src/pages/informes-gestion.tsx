import { useMemo } from "react";
import {
  useGetGestionesMetricas,
} from "@workspace/api-client-react";
import type { GestionMetricaEjecutivo } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download } from "lucide-react";
import { format } from "date-fns";
import { FiltroBArra, useFiltroBarra } from "@/components/informes/filtro-barra";

function GestionesEjecutivos() {
  const { data: metricas, isLoading } = useGetGestionesMetricas();

  const rows = useMemo(() => {
    const list = (metricas ?? []).slice();
    return list.sort((a, b) => b.gestionesRealizadas - a.gestionesRealizadas);
  }, [metricas]);

  const fmtPct = (v: number) => `${Math.round(v * 100)}%`;

  const exportar = async () => {
    const XLSX = await import("xlsx");
    const data = rows.map((m: GestionMetricaEjecutivo) => ({
      Ejecutivo: m.usuarioNombre ?? m.usuarioId,
      "Gestiones realizadas": m.gestionesRealizadas,
      Intentos: m.intentos,
      Contactados: m.contactados,
      "Tasa contacto efectivo": fmtPct(m.tasaContactoEfectivo),
      "Cobros gestionados": m.cobrosGestionados,
      "Cobros recuperados": m.cobrosRecuperados,
      "Tasa recuperación": fmtPct(m.tasaRecuperacion),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Gestiones por ejecutivo");
    XLSX.writeFile(wb, `gestiones-ejecutivos-${format(new Date(), "yyyyMMdd")}.xlsx`);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? "Cargando..."
            : `${rows.length} ejecutivo${rows.length !== 1 ? "s" : ""} con actividad de cobranza.`}
        </p>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={exportar}
          disabled={rows.length === 0}
        >
          <Download className="h-4 w-4" />
          Exportar Excel
        </Button>
      </div>

      <Card className="shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-xs">Ejecutivo</TableHead>
              <TableHead className="text-xs text-right">Gestiones</TableHead>
              <TableHead className="text-xs text-right">Intentos</TableHead>
              <TableHead className="text-xs text-right">Contactados</TableHead>
              <TableHead className="text-xs text-right">Tasa contacto</TableHead>
              <TableHead className="text-xs text-right">Cobros gestionados</TableHead>
              <TableHead className="text-xs text-right">Recuperados</TableHead>
              <TableHead className="text-xs text-right">Tasa recuperación</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [1, 2, 3].map((i) => (
                <TableRow key={i} className="animate-pulse">
                  <TableCell><div className="h-4 w-40 bg-muted rounded" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground text-sm">
                  Sin gestiones de cobranza registradas.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((m) => (
                <TableRow key={m.usuarioId} className="hover:bg-muted/40 transition-colors">
                  <TableCell className="font-medium text-sm">{m.usuarioNombre ?? m.usuarioId}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{m.gestionesRealizadas}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{m.intentos}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{m.contactados}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums font-medium">{fmtPct(m.tasaContactoEfectivo)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{m.cobrosGestionados}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{m.cobrosRecuperados}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums font-medium">{fmtPct(m.tasaRecuperacion)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

export default function InformesGestion() {
  const filtro = useFiltroBarra("1m");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Informes</p>
        <h1 className="text-2xl font-bold tracking-tight">Gestión</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Rendimiento del equipo de cobranza por ejecutivo.</p>
      </div>

      <FiltroBArra {...filtro} />

      <Tabs defaultValue="gestiones" className="space-y-5">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="gestiones">Gestiones</TabsTrigger>
        </TabsList>
        <TabsContent value="gestiones" className="space-y-6 mt-0">
          <GestionesEjecutivos />
        </TabsContent>
      </Tabs>
    </div>
  );
}
