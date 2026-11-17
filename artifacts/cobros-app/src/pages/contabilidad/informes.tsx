import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, FileText, TrendingUp, BookOpen, Layers, BarChart3, Calculator } from "lucide-react";
import { format } from "date-fns";

const currentYear = new Date().getFullYear();
const currentMonth = String(new Date().getMonth() + 1).padStart(2, "0");
const defaultPeriodo = `${currentYear}${currentMonth}`;
const defaultPeriodoDesde = `${currentYear}01`;

function fmt(n: number | null | undefined) {
  if (n == null) return "0";
  return Math.abs(n).toLocaleString("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtSigned(n: number) {
  if (n > 0) return `$ ${fmt(n)}`;
  if (n < 0) return `($ ${fmt(n)})`;
  return "$ 0";
}

// ═══ BALANCE 8 COLUMNAS ═══
function Balance8ColTab() {
  const [desde, setDesde] = useState(defaultPeriodoDesde);
  const [hasta, setHasta] = useState(defaultPeriodo);
  const [ejecutar, setEjecutar] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["balance-8col", desde, hasta],
    queryFn: async () => {
      const res = await fetch(`/api/contabilidad/informes/balance-8col?periodoDesde=${desde}&periodoHasta=${hasta}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json() as Promise<any[]>;
    },
    enabled: ejecutar,
  });

  const TIPO_COLORS: Record<string, string> = {
    activo: "text-blue-600", pasivo: "text-red-600", patrimonio: "text-purple-600",
    ingreso: "text-green-600", egreso: "text-orange-600", orden: "text-gray-500",
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Período desde (AAAAMM)</Label>
          <Input className="w-32" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Período hasta (AAAAMM)</Label>
          <Input className="w-32" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => setEjecutar(true)}>Generar balance</Button>
      </div>

      {isLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

      {data && data.length > 0 && (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-28">Código</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cuenta</th>
                <th className="text-right py-2.5 px-2 text-xs font-semibold text-muted-foreground">SA Debe</th>
                <th className="text-right py-2.5 px-2 text-xs font-semibold text-muted-foreground">SA Haber</th>
                <th className="text-right py-2.5 px-2 text-xs font-semibold text-muted-foreground">Mov Debe</th>
                <th className="text-right py-2.5 px-2 text-xs font-semibold text-muted-foreground">Mov Haber</th>
                <th className="text-right py-2.5 px-2 text-xs font-semibold text-muted-foreground">SF Debe</th>
                <th className="text-right py-2.5 px-2 text-xs font-semibold text-muted-foreground">SF Haber</th>
              </tr>
            </thead>
            <tbody>
              {data.filter((r) => r.saldoFinalDebe !== 0 || r.saldoFinalHaber !== 0 || r.movDebe !== 0 || r.movHaber !== 0).map((r) => (
                <tr key={r.cuentaId} className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3 font-mono text-xs">{r.codigo}</td>
                  <td className={`py-2 px-3 text-sm ${TIPO_COLORS[r.tipo] ?? ""}`}>{r.nombre}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs">{r.saldoAntDebe ? fmt(r.saldoAntDebe) : "—"}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs">{r.saldoAntHaber ? fmt(r.saldoAntHaber) : "—"}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs">{r.movDebe ? fmt(r.movDebe) : "—"}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs">{r.movHaber ? fmt(r.movHaber) : "—"}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs font-medium">{r.saldoFinalDebe ? fmt(r.saldoFinalDebe) : "—"}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs font-medium">{r.saldoFinalHaber ? fmt(r.saldoFinalHaber) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>Sin movimientos en el período seleccionado</p>
        </div>
      )}
    </div>
  );
}

// ═══ BALANCE COMPARATIVO ═══
function BalanceComparativoTab() {
  const [periodos, setPeriodos] = useState(`${currentYear}01,${currentYear}02,${currentYear}03`);
  const [ejecutar, setEjecutar] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["balance-comparativo", periodos],
    queryFn: async () => {
      const res = await fetch(`/api/contabilidad/informes/balance-comparativo?periodos=${encodeURIComponent(periodos)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json() as Promise<{ periodos: string[]; movimientos: any[] }>;
    },
    enabled: ejecutar,
  });

  // Agrupar por cuenta
  const cuentas: Record<string, { codigo: string; nombre: string; datos: Record<string, number> }> = {};
  data?.movimientos.forEach((r) => {
    if (!cuentas[r.cuentaCodigo]) {
      cuentas[r.cuentaCodigo] = { codigo: r.cuentaCodigo, nombre: r.cuentaNombre, datos: {} };
    }
    const neto = r.sumaDebe - r.sumaHaber;
    cuentas[r.cuentaCodigo].datos[r.periodo] = (cuentas[r.cuentaCodigo].datos[r.periodo] ?? 0) + neto;
  });

  const periodosArr = data?.periodos ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1 flex-1 max-w-sm">
          <Label className="text-xs">Períodos a comparar (AAAAMM separados por coma)</Label>
          <Input value={periodos} onChange={(e) => setPeriodos(e.target.value)} placeholder="202401,202402,202403" />
        </div>
        <Button size="sm" onClick={() => setEjecutar(true)}>Comparar</Button>
      </div>

      {isLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

      {data && Object.keys(cuentas).length > 0 && (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cuenta</th>
                {periodosArr.map((p) => (
                  <th key={p} className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {`${p.substring(4, 6)}/${p.substring(0, 4)}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.values(cuentas).sort((a, b) => a.codigo.localeCompare(b.codigo)).map((c) => (
                <tr key={c.codigo} className="border-b hover:bg-muted/20">
                  <td className="py-2 px-3">
                    <span className="font-mono text-xs text-muted-foreground mr-2">{c.codigo}</span>
                    {c.nombre}
                  </td>
                  {periodosArr.map((p) => (
                    <td key={p} className={`py-2 px-3 text-right font-mono text-xs ${(c.datos[p] ?? 0) < 0 ? "text-red-600" : ""}`}>
                      {c.datos[p] ? fmtSigned(c.datos[p]) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══ ESTADO DE RESULTADO ═══
function EstadoResultadoTab() {
  const [desde, setDesde] = useState(defaultPeriodoDesde);
  const [hasta, setHasta] = useState(defaultPeriodo);
  const [ejecutar, setEjecutar] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["estado-resultado", desde, hasta],
    queryFn: async () => {
      const res = await fetch(`/api/contabilidad/informes/estado-resultado?periodoDesde=${desde}&periodoHasta=${hasta}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json() as Promise<{ lineas: any[]; totalIngresos: number; totalEgresos: number; utilidadNeta: number }>;
    },
    enabled: ejecutar,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Período desde (AAAAMM)</Label>
          <Input className="w-32" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Período hasta (AAAAMM)</Label>
          <Input className="w-32" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => setEjecutar(true)}>Generar informe</Button>
      </div>

      {isLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

      {data && (
        <div className="space-y-4">
          {/* Resumen */}
          <div className="grid grid-cols-3 gap-4">
            <div className="border rounded-lg p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Ingresos</p>
              <p className="text-2xl font-bold text-green-600 mt-1">$ {fmt(data.totalIngresos)}</p>
            </div>
            <div className="border rounded-lg p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Egresos</p>
              <p className="text-2xl font-bold text-red-600 mt-1">$ {fmt(data.totalEgresos)}</p>
            </div>
            <div className={`border rounded-lg p-4 text-center ${data.utilidadNeta >= 0 ? "bg-green-50 dark:bg-green-900/10 border-green-200" : "bg-red-50 dark:bg-red-900/10 border-red-200"}`}>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Utilidad Neta</p>
              <p className={`text-2xl font-bold mt-1 ${data.utilidadNeta >= 0 ? "text-green-700" : "text-red-700"}`}>
                {fmtSigned(data.utilidadNeta)}
              </p>
            </div>
          </div>

          {/* Tabla detalle */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cuenta</th>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-24">Tipo</th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-32">Monto</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-green-50/50 dark:bg-green-900/5 border-b">
                  <td colSpan={3} className="py-2 px-3 text-xs font-semibold text-green-700 uppercase tracking-wider">INGRESOS</td>
                </tr>
                {data.lineas.filter((l) => l.tipo === "ingreso").map((l) => (
                  <tr key={l.cuentaId} className="border-b hover:bg-muted/20">
                    <td className="py-2 px-3"><span className="font-mono text-xs text-muted-foreground mr-2">{l.codigo}</span>{l.nombre}</td>
                    <td className="py-2 px-3 text-xs text-green-600">Ingreso</td>
                    <td className="py-2 px-3 text-right font-mono font-medium text-green-700">$ {fmt(l.neto)}</td>
                  </tr>
                ))}
                <tr className="bg-red-50/50 dark:bg-red-900/5 border-b border-t-2">
                  <td colSpan={3} className="py-2 px-3 text-xs font-semibold text-red-700 uppercase tracking-wider">EGRESOS</td>
                </tr>
                {data.lineas.filter((l) => l.tipo === "egreso").map((l) => (
                  <tr key={l.cuentaId} className="border-b hover:bg-muted/20">
                    <td className="py-2 px-3"><span className="font-mono text-xs text-muted-foreground mr-2">{l.codigo}</span>{l.nombre}</td>
                    <td className="py-2 px-3 text-xs text-red-600">Egreso</td>
                    <td className="py-2 px-3 text-right font-mono font-medium text-red-700">$ {fmt(l.neto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ LIBRO DIARIO ═══
function LibroDiarioTab() {
  const [desde, setDesde] = useState(defaultPeriodo);
  const [hasta, setHasta] = useState(defaultPeriodo);
  const [ejecutar, setEjecutar] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["libro-diario", desde, hasta],
    queryFn: async () => {
      const res = await fetch(`/api/contabilidad/informes/libro-diario?periodoDesde=${desde}&periodoHasta=${hasta}&limit=200`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json() as Promise<any[]>;
    },
    enabled: ejecutar,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Período desde (AAAAMM)</Label>
          <Input className="w-32" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Período hasta (AAAAMM)</Label>
          <Input className="w-32" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => setEjecutar(true)}>Generar libro</Button>
      </div>

      {isLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

      {data && data.length > 0 && (
        <div className="space-y-4">
          {data.map((a) => (
            <div key={a.id} className="border rounded-lg overflow-hidden">
              <div className="bg-muted/40 px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold">{a.numero}</span>
                  <span className="text-sm text-muted-foreground">
                    {format(new Date(a.fecha + "T12:00:00"), "dd/MM/yyyy")}
                  </span>
                  <span className="text-sm">{a.descripcion}</span>
                </div>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {a.lineas.map((l: any, i: number) => (
                    <tr key={i} className="border-t">
                      <td className="py-2 px-3 font-mono text-xs text-muted-foreground w-24">{l.cuentaCodigo}</td>
                      <td className="py-2 px-3">{l.cuentaNombre}</td>
                      <td className="py-2 px-3 text-right font-mono text-xs w-28">
                        {parseFloat(l.debe) > 0 ? `$ ${fmt(parseFloat(l.debe))}` : ""}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-xs w-28">
                        {parseFloat(l.haber) > 0 ? `$ ${fmt(parseFloat(l.haber))}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ LIBRO MAYOR ═══
function LibroMayorTab() {
  const [cuentaId, setCuentaId] = useState("");
  const [desde, setDesde] = useState(defaultPeriodo);
  const [hasta, setHasta] = useState(defaultPeriodo);
  const [ejecutar, setEjecutar] = useState(false);

  const { data: cuentas = [] } = useQuery({
    queryKey: ["cuentas-hojas"],
    queryFn: async () => {
      const res = await fetch("/api/contabilidad/plan-cuentas/hojas", { credentials: "include" });
      if (!res.ok) return [];
      return res.json() as Promise<any[]>;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["libro-mayor", cuentaId, desde, hasta],
    queryFn: async () => {
      const res = await fetch(`/api/contabilidad/informes/libro-mayor?cuentaId=${cuentaId}&periodoDesde=${desde}&periodoHasta=${hasta}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json() as Promise<{ cuenta: any; saldoAnterior: number; movimientos: any[] }>;
    },
    enabled: ejecutar && !!cuentaId,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1 flex-1 max-w-xs">
          <Label className="text-xs">Cuenta</Label>
          <Select value={cuentaId} onValueChange={setCuentaId}>
            <SelectTrigger><SelectValue placeholder="Selecciona cuenta..." /></SelectTrigger>
            <SelectContent>
              {cuentas.map((c: any) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.codigo} — {c.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Desde (AAAAMM)</Label>
          <Input className="w-32" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Hasta (AAAAMM)</Label>
          <Input className="w-32" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => setEjecutar(true)} disabled={!cuentaId}>Ver mayor</Button>
      </div>

      {isLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

      {data && (
        <div className="space-y-3">
          <div className="bg-muted/40 rounded-lg px-4 py-2 flex gap-6 text-sm">
            <span><strong>{data.cuenta.codigo}</strong> — {data.cuenta.nombre}</span>
            <span className="text-muted-foreground">Saldo anterior: <strong>$ {fmt(data.saldoAnterior)}</strong></span>
          </div>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b">
                <tr>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">Fecha</th>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">N° Asiento</th>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">Descripción</th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground">Debe</th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground">Haber</th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {data.movimientos.map((m: any, i: number) => (
                  <tr key={i} className="border-b hover:bg-muted/20">
                    <td className="py-2 px-3 text-xs">{format(new Date(m.fecha + "T12:00:00"), "dd/MM/yyyy")}</td>
                    <td className="py-2 px-3 font-mono text-xs">{m.numero}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground">{m.descripcionAsiento}</td>
                    <td className="py-2 px-3 text-right font-mono text-xs">{parseFloat(m.debe) > 0 ? `$ ${fmt(parseFloat(m.debe))}` : "—"}</td>
                    <td className="py-2 px-3 text-right font-mono text-xs">{parseFloat(m.haber) > 0 ? `$ ${fmt(parseFloat(m.haber))}` : "—"}</td>
                    <td className={`py-2 px-3 text-right font-mono text-xs font-medium ${m.saldo < 0 ? "text-red-600" : ""}`}>$ {fmt(m.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ CÁLCULO IVA ═══
function CalculoIvaTab() {
  const [periodo, setPeriodo] = useState(defaultPeriodo);
  const [ejecutar, setEjecutar] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["calculo-iva", periodo],
    queryFn: async () => {
      const res = await fetch(`/api/contabilidad/informes/calculo-iva?periodo=${periodo}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json() as Promise<any>;
    },
    enabled: ejecutar,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Período (AAAAMM)</Label>
          <Input className="w-32" value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => setEjecutar(true)}>Calcular IVA</Button>
      </div>

      {isLoading && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

      {data && (
        <div className="space-y-6">
          {/* F29 */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-blue-50 dark:bg-blue-900/20 border-b px-4 py-2.5">
              <h3 className="font-semibold text-blue-800 dark:text-blue-300">Formulario 29 — IVA Mensual</h3>
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">Período {data.periodo.substring(4, 6)}/{data.periodo.substring(0, 4)}</p>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ventas</h4>
                  <div className="flex justify-between text-sm py-1 border-b"><span>Ventas netas afectas</span><span className="font-mono font-medium">$ {fmt(data.f29.ventasNetas)}</span></div>
                  <div className="flex justify-between text-sm py-1 border-b"><span>Ventas exentas / no afectas</span><span className="font-mono">$ {fmt(data.f29.ventasExentas)}</span></div>
                  <div className="flex justify-between text-sm py-1 bg-muted/30 px-2 rounded font-semibold">
                    <span>IVA Débito Fiscal (19%)</span>
                    <span className="font-mono text-primary">$ {fmt(data.f29.ivaDebito)}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Compras</h4>
                  <div className="flex justify-between text-sm py-1 border-b"><span>Compras netas afectas</span><span className="font-mono font-medium">$ {fmt(data.f29.comprasNetas)}</span></div>
                  <div className="flex justify-between text-sm py-1 border-b"><span>IVA no recuperable</span><span className="font-mono text-muted-foreground">$ {fmt(data.f29.ivaNoRecuperable)}</span></div>
                  <div className="flex justify-between text-sm py-1 bg-muted/30 px-2 rounded font-semibold">
                    <span>IVA Crédito Fiscal</span>
                    <span className="font-mono text-green-600">$ {fmt(data.f29.ivaCredito)}</span>
                  </div>
                </div>
              </div>

              <div className={`mt-4 p-4 rounded-lg border-2 text-center ${data.f29.situacion === "pago" ? "border-red-200 bg-red-50 dark:bg-red-900/10" : data.f29.situacion === "remanente" ? "border-green-200 bg-green-50 dark:bg-green-900/10" : "border-muted"}`}>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  {data.f29.situacion === "pago" ? "IVA A PAGAR" : data.f29.situacion === "remanente" ? "REMANENTE A FAVOR" : "SIN DIFERENCIA"}
                </p>
                <p className={`text-3xl font-bold font-mono ${data.f29.situacion === "pago" ? "text-red-700" : data.f29.situacion === "remanente" ? "text-green-700" : "text-muted-foreground"}`}>
                  $ {fmt(Math.abs(data.f29.ivaDeterminar))}
                </p>
              </div>
            </div>
          </div>

          <div className="text-sm text-muted-foreground bg-muted/30 rounded p-3">
            <strong>Formulario 22 (Renta anual)</strong> y <strong>Formulario 50 (Retenciones)</strong> requieren información adicional de remuneraciones y retenciones. Se generarán desde el módulo de RR.HH. una vez disponible.
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ COMPONENTE PRINCIPAL ═══
interface Props { hideHeader?: boolean }

export default function InformesContabilidadPage({ hideHeader }: Props) {
  return (
    <div className="space-y-5">
      {!hideHeader && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contabilidad</p>
          <h1 className="text-2xl font-bold tracking-tight">Informes Contables</h1>
        </div>
      )}

      <Tabs defaultValue="balance8" className="space-y-5">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="balance8" className="gap-1.5">
            <Layers className="h-4 w-4" />
            Balance 8 columnas
          </TabsTrigger>
          <TabsTrigger value="comparativo" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            Balance comparativo
          </TabsTrigger>
          <TabsTrigger value="resultado" className="gap-1.5">
            <TrendingUp className="h-4 w-4" />
            Estado de resultado
          </TabsTrigger>
          <TabsTrigger value="diario" className="gap-1.5">
            <FileText className="h-4 w-4" />
            Libro diario
          </TabsTrigger>
          <TabsTrigger value="mayor" className="gap-1.5">
            <BookOpen className="h-4 w-4" />
            Libro mayor
          </TabsTrigger>
          <TabsTrigger value="iva" className="gap-1.5">
            <Calculator className="h-4 w-4" />
            Cálculo IVA
          </TabsTrigger>
        </TabsList>

        <TabsContent value="balance8" className="mt-0"><Balance8ColTab /></TabsContent>
        <TabsContent value="comparativo" className="mt-0"><BalanceComparativoTab /></TabsContent>
        <TabsContent value="resultado" className="mt-0"><EstadoResultadoTab /></TabsContent>
        <TabsContent value="diario" className="mt-0"><LibroDiarioTab /></TabsContent>
        <TabsContent value="mayor" className="mt-0"><LibroMayorTab /></TabsContent>
        <TabsContent value="iva" className="mt-0"><CalculoIvaTab /></TabsContent>
      </Tabs>
    </div>
  );
}
