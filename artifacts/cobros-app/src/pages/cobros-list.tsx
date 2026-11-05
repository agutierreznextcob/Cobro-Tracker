import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { useToast } from "@/hooks/use-toast";
import SuscripcionesRegistro from "./suscripciones-registro";
import { useListCobros, useListClientes, useSendRecordatoriosMasivos } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, formatShortDate } from "@/lib/format";
import { tipoDocumentoLabelCorto } from "@/lib/tipo-documento";
import { StatusBadge } from "@/components/status-badge";
import { ScoreBadge, SCORE_META } from "@/components/score-badge";
import { ArrowRight, Minus, Search, X, Lock } from "lucide-react";
import type { ListCobrosParams, ScoreCategoria } from "@workspace/api-client-react";

type EstadoFilter = ListCobrosParams["estado"];
type MetodoFilter = ListCobrosParams["metodo"];

const CATEGORIAS_SCORE: { value: ScoreCategoria; label: string }[] = [
  { value: "excelente", label: "Excelente" },
  { value: "bueno", label: "Bueno" },
  { value: "regular", label: "Regular" },
  { value: "riesgoso", label: "Riesgoso" },
  { value: "critico", label: "Crítico" },
  { value: "sin_datos", label: "Sin historial" },
];

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
  // La cuenta superadmin no gestiona cobros propios: su módulo de Cobros
  // muestra el registro de pagos de suscripciones de la plataforma.
  const { user } = useAuth();
  if (user?.role === "admin") {
    return <SuscripcionesRegistro />;
  }
  return <CobrosListNormal />;
}

function CobrosListNormal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [filterEstado, setFilterEstado] = useState<EstadoFilter>(undefined);
  const [filterMetodo, setFilterMetodo] = useState<MetodoFilter>(undefined);
  const [filterScore, setFilterScore] = useState<ScoreCategoria | undefined>(undefined);
  const [busquedaCliente, setBusquedaCliente] = useState("");
  const [debouncedBusqueda, setDebouncedBusqueda] = useState("");
  const [seleccionados, setSeleccionados] = useState<number[]>([]);
  const [canales, setCanales] = useState<Array<"email" | "whatsapp">>(["email"]);
  const [enviandoMasivo, setEnviandoMasivo] = useState(false);
  const sendRecordatoriosMasivos = useSendRecordatoriosMasivos();
  const [resultadosMasivos, setResultadosMasivos] = useState<Array<{ cobroId?: number; canal: string; estado: string; detalle?: string; waUrl?: string }>>([]);
  const [filtroRecordatorio, setFiltroRecordatorio] = useState<"pendientes" | "vencidos">("pendientes");
  const [, navigate] = useLocation();

  const { data: clientes } = useListClientes();
  const categoriaPorCliente = useMemo(() => {
    const map = new Map<number, ScoreCategoria>();
    for (const c of clientes ?? []) map.set(c.id, c.categoria);
    return map;
  }, [clientes]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedBusqueda(busquedaCliente), 250);
    return () => clearTimeout(t);
  }, [busquedaCliente]);

  const params: ListCobrosParams = {};
  if (filterEstado) params.estado = filterEstado;
  if (filterMetodo) params.metodo = filterMetodo;

  const { data: cobros, isLoading } = useListCobros(params, {
    query: { queryKey: ["listCobros", params] as const },
  });

  const cobrosFiltrados = useMemo(() => {
    if (!cobros) return cobros;
    const q = debouncedBusqueda.trim().toLowerCase();
    return cobros.filter((c) => {
      if (q && !(c.clienteNombre ?? "").toLowerCase().includes(q)) return false;
      if (filterScore) {
        const cat = c.clienteId != null ? categoriaPorCliente.get(c.clienteId) : undefined;
        if ((cat ?? "sin_datos") !== filterScore) return false;
      }
      return true;
    });
  }, [cobros, debouncedBusqueda, filterScore, categoriaPorCliente]);

  const hayFiltros = !!filterEstado || !!filterMetodo || !!filterScore || busquedaCliente.trim() !== "";
  const planUser = user as (typeof user & { subscriptionStatus?: string; plan?: string }) | null;
  const nextCob = user?.role === "admin" || user?.esDemo || planUser?.subscriptionStatus === "prueba" || planUser?.plan !== "starter";
  const recordables = (cobrosFiltrados ?? []).filter((c) => {
    if (c.estado !== "pendiente" && c.estado !== "parcial") return false;
    const vencido = !!c.fechaVencimiento && new Date(`${c.fechaVencimiento}T00:00:00`) < new Date(new Date().toDateString());
    return filtroRecordatorio === "vencidos" ? vencido : !vencido;
  });
  const toggleAll = () => setSeleccionados(seleccionados.length === recordables.length ? [] : recordables.map((c) => c.id));
  const enviarMasivo = async () => {
    if (!nextCob) { toast({ title: "Disponible en plan NextCob", description: "Disponible en plan NextCob", variant: "destructive" }); return; }
    if (!seleccionados.length || !canales.length) return;
    setEnviandoMasivo(true);
    try {
      const data = await sendRecordatoriosMasivos.mutateAsync({ data: { cobroIds: seleccionados, canales } });
      setResultadosMasivos(data.results ?? []);
      const enviados = data.results?.filter((x) => x.estado === "enviado").length ?? 0;
      const pendientes = data.results?.filter((x) => x.estado === "pendiente_manual").length ?? 0;
      toast({ title: "Recordatorios procesados", description: `${enviados} enviados${pendientes ? `; ${pendientes} WhatsApp listos para envío manual` : ""}.` });
      setSeleccionados([]);
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "No se pudieron enviar recordatorios.", variant: "destructive" });
    } finally { setEnviandoMasivo(false); }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cobros</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLoading ? "Cargando..." : `${cobrosFiltrados?.length ?? 0} cobro${cobrosFiltrados?.length !== 1 ? "s" : ""}`}
            {hayFiltros ? " (con filtros)" : ""}
          </p>
        </div>
        <Link href="/cobros/nuevo">
          <Button size="sm">+ Nuevo cobro</Button>
        </Link>
      </div>

      <Card className="p-3 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium flex items-center gap-1">{!nextCob && <Lock className="h-3.5 w-3.5" />}Enviar recordatorio masivo</span>
        <span className="text-xs text-muted-foreground">Selecciona cobros pendientes o vencidos y el canal.</span>
        <Select value={filtroRecordatorio} onValueChange={(value) => { setFiltroRecordatorio(value as "pendientes" | "vencidos"); setSeleccionados([]); }}><SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pendientes">Pendientes</SelectItem><SelectItem value="vencidos">Vencidos</SelectItem></SelectContent></Select>
        {(["email", "whatsapp"] as const).map((canal) => <label key={canal} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={canales.includes(canal)} onChange={(e) => setCanales((current) => e.target.checked ? [...current, canal] : current.filter((x) => x !== canal))} />{canal === "email" ? "Email" : "WhatsApp"}</label>)}
        <Button size="sm" className="ml-auto" disabled={!seleccionados.length || !canales.length || enviandoMasivo} onClick={enviarMasivo}>{!nextCob && <Lock className="mr-1 h-3 w-3" />}{enviandoMasivo ? "Enviando..." : `Enviar (${seleccionados.length})`}</Button>
        {!nextCob && <span className="w-full text-xs text-muted-foreground">Disponible en plan NextCob</span>}
      </Card>

      {resultadosMasivos.length > 0 && (
        <Card className="p-4 space-y-3" aria-live="polite">
          <h2 className="font-semibold text-sm">Resultado de recordatorios</h2>
          {resultadosMasivos.map((r, index) => {
            const waUrl = r.waUrl ?? (r.estado === "pendiente_manual" && r.detalle?.startsWith("https://wa.me/") ? r.detalle : undefined);
            return (
              <div key={`${r.cobroId}-${r.canal}-${index}`} className="flex flex-wrap items-center gap-2 text-sm border-t pt-2">
                <span className="font-medium">Cobro #{r.cobroId} · {r.canal === "email" ? "Email" : "WhatsApp"}</span>
                <span className={r.estado === "fallido" ? "text-destructive" : "text-muted-foreground"}>
                  {r.estado === "enviado" ? "Enviado" : r.estado === "pendiente_manual" ? "Listo para envío manual" : `No enviado: ${r.detalle ?? "Error de envío"}`}
                </span>
                {waUrl && <a className="text-primary underline ml-auto" href={waUrl} target="_blank" rel="noreferrer">Abrir WhatsApp</a>}
              </div>
            );
          })}
        </Card>
      )}

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

        <Select
          value={filterScore ?? ""}
          onValueChange={(v) => setFilterScore(v ? (v as ScoreCategoria) : undefined)}
        >
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue placeholder="Score: todos" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIAS_SCORE.map((c) => (
              <SelectItem key={c.value} value={c.value} className="text-xs">
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={busquedaCliente}
            onChange={(e) => setBusquedaCliente(e.target.value)}
            placeholder="Buscar cliente"
            className="h-8 w-full pl-8 text-xs"
          />
        </div>

        {hayFiltros && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            onClick={() => { setFilterEstado(undefined); setFilterMetodo(undefined); setFilterScore(undefined); setBusquedaCliente(""); setDebouncedBusqueda(""); }}
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
              <TableHead className="w-8"><input aria-label="Seleccionar todos los cobros recordables" type="checkbox" checked={recordables.length > 0 && seleccionados.length === recordables.length} onChange={toggleAll} /></TableHead>
              <TableHead className="text-xs">Fecha</TableHead>
              <TableHead className="text-xs">Descripción</TableHead>
              <TableHead className="text-xs">Cliente</TableHead>
              <TableHead className="text-xs">Estado</TableHead>
              <TableHead className="text-xs">Tipo doc.</TableHead>
              <TableHead className="text-xs">Método</TableHead>
              <TableHead className="text-xs text-right">Monto</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [1, 2, 3, 4, 5, 6].map((i) => (
                <TableRow key={i} className="animate-pulse">
                  <TableCell /><TableCell><div className="h-4 w-20 bg-muted rounded" /></TableCell>
                  <TableCell><div className="h-4 w-48 bg-muted rounded" /></TableCell>
                  <TableCell><div className="h-4 w-28 bg-muted rounded" /></TableCell>
                  <TableCell><div className="h-5 w-20 bg-muted rounded-full" /></TableCell>
                  <TableCell><div className="h-4 w-20 bg-muted rounded" /></TableCell>
                  <TableCell><div className="h-5 w-16 bg-muted rounded-full" /></TableCell>
                  <TableCell><div className="h-4 w-16 bg-muted rounded ml-auto" /></TableCell>
                  <TableCell />
                </TableRow>
              ))
            ) : !cobrosFiltrados || cobrosFiltrados.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-32 text-center text-muted-foreground text-sm">
                  {hayFiltros ? "Ningún cobro coincide con los filtros." : "Sin cobros registrados."}
                </TableCell>
              </TableRow>
            ) : (
              cobrosFiltrados.map((cobro) => (
                <TableRow
                  key={cobro.id}
                  className="cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => navigate(`/cobros/${cobro.id}`)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {recordables.some((item) => item.id === cobro.id) && <input aria-label={`Seleccionar cobro ${cobro.id}`} type="checkbox" checked={seleccionados.includes(cobro.id)} onChange={(e) => setSeleccionados((ids) => e.target.checked ? [...ids, cobro.id] : ids.filter((id) => id !== cobro.id))} />}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatShortDate(cobro.creadoEn)}
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <div className="text-sm font-medium truncate">{cobro.descripcion}</div>
                    {(cobro as typeof cobro & { loteId?: string | null }).loteId && <Badge variant="secondary" className="mt-1 text-[9px]">Generado en lote</Badge>}
                    {cobro.referencia && (
                      <div className="text-[10px] text-muted-foreground/60 font-mono truncate">{cobro.referencia}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">
                        {cobro.clienteNombre ?? cobro.responsableNombre ?? <span className="opacity-40">—</span>}
                      </span>
                      {cobro.clienteId != null && categoriaPorCliente.has(cobro.clienteId) && (
                        <ScoreBadge
                          score={null}
                          categoria={categoriaPorCliente.get(cobro.clienteId)!}
                          size="xs"
                          showLabel={false}
                        />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={cobro.estado} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {tipoDocumentoLabelCorto(cobro.tipoDocumento)}
                    {cobro.numeroDocumento && <span className="block font-mono text-[10px] text-foreground/70">{cobro.numeroDocumento}</span>}
                    {cobro.cotizacionId && <span className="block text-[10px] text-primary">desde cotización</span>}
                  </TableCell>
                  <TableCell>
                    <MetodoBadge flowLinkPago={cobro.flowLinkPago} mpPaymentLinkUrl={cobro.mpPaymentLinkUrl} />
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold text-sm whitespace-nowrap">
                    {formatMoney(cobro.monto, cobro.moneda, cobro.decimales)}
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
