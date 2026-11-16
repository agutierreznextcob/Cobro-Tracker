import { useState, useMemo, useRef } from "react";
import { useListCobros, useListCotizaciones, useListClientes, useListProveedores, useListInventario } from "@workspace/api-client-react";
import { useListPedidos } from "@/lib/pedidos";
import { useListGuias } from "@/lib/guias-despacho";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { Link } from "wouter";
import {
  Search, X,
  DollarSign, FileText, ShoppingCart, Truck,
  Users, Building2, Package, ChevronRight,
} from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────

function norm(s: string | null | undefined) {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function matches(q: string, ...fields: (string | null | undefined)[]) {
  if (!q) return true;
  return fields.some(f => norm(f).includes(q));
}

function HL({ text, q }: { text: string; q: string }) {
  if (!q || !norm(text).includes(q)) return <>{text}</>;
  const idx = norm(text).indexOf(q);
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-100 dark:bg-yellow-900/40 text-inherit rounded-sm px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

// ─── result row types ────────────────────────────────────────────────────────

type ResultKind = "cobro" | "cotizacion" | "pedido" | "guia" | "cliente" | "proveedor" | "producto";

interface ResultRow {
  kind: ResultKind;
  id: number;
  titulo: string;
  subtitulo?: string;
  meta?: string;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "outline" | "destructive";
  monto?: number;
  moneda?: string;
  decimales?: number;
  href: string;
  rut?: string;
}

const KIND_LABEL: Record<ResultKind, string> = {
  cobro: "Cobro",
  cotizacion: "Cotización",
  pedido: "Pedido",
  guia: "Guía de Despacho",
  cliente: "Cliente",
  proveedor: "Proveedor",
  producto: "Producto",
};

const KIND_ICON: Record<ResultKind, React.ElementType> = {
  cobro: DollarSign,
  cotizacion: FileText,
  pedido: ShoppingCart,
  guia: Truck,
  cliente: Users,
  proveedor: Building2,
  producto: Package,
};

const KIND_COLOR: Record<ResultKind, string> = {
  cobro: "text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30",
  cotizacion: "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30",
  pedido: "text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/30",
  guia: "text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30",
  cliente: "text-cyan-600 dark:text-cyan-400 bg-cyan-100 dark:bg-cyan-900/30",
  proveedor: "text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-900/30",
  producto: "text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30",
};

const KINDS: ResultKind[] = ["cobro", "cotizacion", "pedido", "guia", "cliente", "proveedor", "producto"];

// ─── main component ──────────────────────────────────────────────────────────

export default function SearchPage() {
  const [texto, setTexto] = useState("");
  const [filtroKind, setFiltroKind] = useState<ResultKind | "todos">("todos");
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: cobros, isLoading: loadingCobros } = useListCobros();
  const { data: cotizaciones, isLoading: loadingCotizaciones } = useListCotizaciones();
  const { data: pedidos, isLoading: loadingPedidos } = useListPedidos();
  const { data: guias, isLoading: loadingGuias } = useListGuias();
  const { data: clientes, isLoading: loadingClientes } = useListClientes();
  const { data: proveedores, isLoading: loadingProveedores } = useListProveedores();
  const { data: productos, isLoading: loadingProductos } = useListInventario();

  const isLoading = loadingCobros || loadingCotizaciones || loadingPedidos || loadingGuias ||
    loadingClientes || loadingProveedores || loadingProductos;

  const q = useMemo(() => norm(texto.trim()), [texto]);

  const resultados = useMemo((): ResultRow[] => {
    if (!q) return [];

    const rows: ResultRow[] = [];

    // ── cobros ───────────────────────────────────────────────────────────────
    for (const c of cobros ?? []) {
      if (!matches(q, c.descripcion, c.referencia, String(c.id), c.clienteNombre, c.clienteRut)) continue;
      rows.push({
        kind: "cobro",
        id: c.id,
        titulo: c.descripcion,
        subtitulo: c.clienteNombre,
        meta: c.referencia ?? undefined,
        badge: c.estado,
        monto: Number(c.monto),
        moneda: c.moneda,
        decimales: c.decimales,
        href: `/cobros/${c.id}`,
        rut: c.clienteRut ?? undefined,
      });
    }

    // ── cotizaciones ─────────────────────────────────────────────────────────
    for (const c of (cotizaciones as any[]) ?? []) {
      if (!matches(q, c.numeroCotizacion, String(c.id), c.clienteNombre, c.clienteRut, c.clienteEmail)) continue;
      rows.push({
        kind: "cotizacion",
        id: c.id,
        titulo: c.numeroCotizacion ?? `COT-${c.id}`,
        subtitulo: c.clienteNombre,
        meta: c.clienteRut ?? undefined,
        badge: c.estado,
        monto: Number(c.total ?? 0),
        moneda: c.moneda,
        decimales: c.decimales,
        href: `/cotizaciones/${c.id}`,
        rut: c.clienteRut ?? undefined,
      });
    }

    // ── pedidos ───────────────────────────────────────────────────────────────
    for (const p of (pedidos as any[]) ?? []) {
      if (!matches(q, p.numeroPedido, String(p.id), p.clienteNombre, p.clienteRut)) continue;
      rows.push({
        kind: "pedido",
        id: p.id,
        titulo: p.numeroPedido ?? `PED-${p.id}`,
        subtitulo: p.clienteNombre,
        meta: p.clienteRut ?? undefined,
        badge: p.estado,
        monto: Number(p.total ?? 0),
        moneda: p.moneda,
        decimales: p.decimales,
        href: `/pedidos/${p.id}`,
        rut: p.clienteRut ?? undefined,
      });
    }

    // ── guías de despacho ────────────────────────────────────────────────────
    for (const g of (guias as any[]) ?? []) {
      if (!matches(q, g.numeroGuia, String(g.id), g.clienteNombre, g.clienteRut, g.transportista, g.patenteVehiculo)) continue;
      rows.push({
        kind: "guia",
        id: g.id,
        titulo: g.numeroGuia ?? `GD-${g.id}`,
        subtitulo: g.clienteNombre,
        meta: g.transportista || g.patenteVehiculo || undefined,
        badge: g.estado,
        monto: Number(g.total ?? 0),
        moneda: g.moneda,
        decimales: g.decimales,
        href: `/guias-despacho/${g.id}`,
        rut: g.clienteRut ?? undefined,
      });
    }

    // ── clientes ─────────────────────────────────────────────────────────────
    for (const c of (clientes as any[]) ?? []) {
      if (!matches(q, c.nombre, c.rut, c.email, c.telefono, String(c.id))) continue;
      rows.push({
        kind: "cliente",
        id: c.id,
        titulo: c.nombre,
        subtitulo: c.email ?? undefined,
        meta: c.rut ?? undefined,
        href: `/clientes/${c.id}`,
        rut: c.rut ?? undefined,
      });
    }

    // ── proveedores ───────────────────────────────────────────────────────────
    for (const p of (proveedores as any[]) ?? []) {
      if (!matches(q, p.nombre, p.rut, p.email, p.telefono, String(p.id))) continue;
      rows.push({
        kind: "proveedor",
        id: p.id,
        titulo: p.nombre,
        subtitulo: p.email ?? undefined,
        meta: p.rut ?? undefined,
        href: `/proveedores/${p.id}`,
        rut: p.rut ?? undefined,
      });
    }

    // ── productos / inventario ────────────────────────────────────────────────
    for (const p of (productos as any[]) ?? []) {
      if (!matches(q, p.nombre, p.codigoInterno, p.sku, p.codigoBarras, String(p.id), p.descripcion)) continue;
      rows.push({
        kind: "producto",
        id: p.id,
        titulo: p.nombre,
        subtitulo: p.codigoInterno ?? undefined,
        meta: p.sku || p.codigoBarras || undefined,
        badge: p.tipo,
        monto: Number(p.precioUnitario ?? 0),
        moneda: p.moneda ?? "CLP",
        decimales: p.decimales ?? 0,
        href: `/inventario/${p.id}`,
      });
    }

    return filtroKind === "todos" ? rows : rows.filter(r => r.kind === filtroKind);
  }, [q, cobros, cotizaciones, pedidos, guias, clientes, proveedores, productos, filtroKind]);

  // Count per kind (before kind filter)
  const counts = useMemo((): Partial<Record<ResultKind | "todos", number>> => {
    if (!q) return {};
    const all = resultados.length + (filtroKind !== "todos" ? 0 : 0);
    const base: ResultRow[] = filtroKind === "todos"
      ? resultados
      : (() => {
          // recalculate without kind filter for counts
          return resultados; // won't be accurate if filtered — recalculate separately is better
        })();
    // Simple: return resultados grouped
    const c: Partial<Record<ResultKind, number>> = {};
    for (const r of resultados) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  }, [resultados]);

  // All results without kind filter for tab counts
  const allResultados = useMemo((): ResultRow[] => {
    if (!q) return [];
    const rows: ResultRow[] = [];
    for (const c of cobros ?? []) {
      if (matches(q, c.descripcion, c.referencia, String(c.id), c.clienteNombre, c.clienteRut))
        rows.push({ kind: "cobro", id: c.id, titulo: c.descripcion, href: `/cobros/${c.id}` });
    }
    for (const c of (cotizaciones as any[]) ?? []) {
      if (matches(q, c.numeroCotizacion, String(c.id), c.clienteNombre, c.clienteRut))
        rows.push({ kind: "cotizacion", id: c.id, titulo: c.numeroCotizacion, href: "" });
    }
    for (const p of (pedidos as any[]) ?? []) {
      if (matches(q, p.numeroPedido, String(p.id), p.clienteNombre, p.clienteRut))
        rows.push({ kind: "pedido", id: p.id, titulo: p.numeroPedido, href: "" });
    }
    for (const g of (guias as any[]) ?? []) {
      if (matches(q, g.numeroGuia, String(g.id), g.clienteNombre, g.clienteRut))
        rows.push({ kind: "guia", id: g.id, titulo: g.numeroGuia, href: "" });
    }
    for (const c of (clientes as any[]) ?? []) {
      if (matches(q, c.nombre, c.rut, c.email, String(c.id)))
        rows.push({ kind: "cliente", id: c.id, titulo: c.nombre, href: "" });
    }
    for (const p of (proveedores as any[]) ?? []) {
      if (matches(q, p.nombre, p.rut, p.email, String(p.id)))
        rows.push({ kind: "proveedor", id: p.id, titulo: p.nombre, href: "" });
    }
    for (const p of (productos as any[]) ?? []) {
      if (matches(q, p.nombre, p.codigoInterno, p.sku, p.codigoBarras, String(p.id)))
        rows.push({ kind: "producto", id: p.id, titulo: p.nombre, href: "" });
    }
    return rows;
  }, [q, cobros, cotizaciones, pedidos, guias, clientes, proveedores, productos]);

  const countByKind = useMemo(() => {
    const c: Partial<Record<ResultKind, number>> = {};
    for (const r of allResultados) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  }, [allResultados]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Búsqueda global</h1>
        <p className="text-muted-foreground mt-1">
          Busca por nombre, RUT, número de documento, código de producto o ID en toda la plataforma.
        </p>
      </div>

      {/* Search bar */}
      <div className="relative max-w-2xl">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="RUT, nombre, número de cotización / pedido / guía, producto, código…"
          className="pl-11 pr-10 h-11 text-base"
          autoFocus
        />
        {texto && (
          <button
            onClick={() => { setTexto(""); setFiltroKind("todos"); inputRef.current?.focus(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Kind filter tabs */}
      {q && allResultados.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setFiltroKind("todos")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
              filtroKind === "todos"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:bg-muted"
            }`}
          >
            Todos
            <span className={`text-xs rounded-full px-1.5 py-0.5 ${filtroKind === "todos" ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {allResultados.length}
            </span>
          </button>
          {KINDS.filter(k => countByKind[k]).map(k => {
            const Icon = KIND_ICON[k];
            return (
              <button
                key={k}
                onClick={() => setFiltroKind(k)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                  filtroKind === k
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {KIND_LABEL[k]}
                <span className={`text-xs rounded-full px-1.5 py-0.5 ${filtroKind === k ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {countByKind[k]}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Results */}
      {!q ? (
        // Empty state
        <div className="rounded-xl border border-dashed p-16 text-center space-y-4">
          <Search className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <div>
            <p className="font-medium text-base">Escribe algo para buscar</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
              Busca en cobros, cotizaciones, pedidos, guías de despacho, clientes, proveedores y productos de inventario.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {[
              { label: "RUT cliente / proveedor", example: "76.123.456-7" },
              { label: "N° cotización", example: "COT-0001" },
              { label: "N° pedido", example: "PED-0001" },
              { label: "Código producto", example: "PROD-0001" },
            ].map(({ label, example }) => (
              <button
                key={label}
                onClick={() => setTexto(example)}
                className="inline-flex flex-col items-start px-3 py-2 rounded-lg border bg-card hover:bg-muted transition-colors text-left"
              >
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="text-sm font-mono font-medium">{example}</span>
              </button>
            ))}
          </div>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : resultados.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center space-y-2">
          <Search className="h-8 w-8 text-muted-foreground/40 mx-auto" />
          <p className="font-medium">Sin resultados para "{texto}"</p>
          <p className="text-sm text-muted-foreground">
            Intenta con otro término, RUT, número de documento o código.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground mb-3">
            {resultados.length} resultado{resultados.length !== 1 ? "s" : ""}
            {filtroKind !== "todos" ? ` en ${KIND_LABEL[filtroKind]}` : ""}
          </p>
          {resultados.map((r, idx) => {
            const Icon = KIND_ICON[r.kind];
            const colorClass = KIND_COLOR[r.kind];
            return (
              <Link key={`${r.kind}-${r.id}-${idx}`} href={r.href}>
                <div className="group flex items-center gap-3 px-4 py-3 rounded-xl border bg-card hover:bg-muted/40 transition-colors cursor-pointer">
                  {/* Kind icon */}
                  <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${colorClass}`}>
                    <Icon className="h-4 w-4" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        <HL text={r.titulo} q={q} />
                      </span>
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {KIND_LABEL[r.kind]} #{r.id}
                      </span>
                      {r.badge && (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground border">
                          {r.badge}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {r.subtitulo && (
                        <span className="text-xs text-muted-foreground">
                          <HL text={r.subtitulo} q={q} />
                        </span>
                      )}
                      {r.rut && (
                        <span className="text-xs font-mono text-muted-foreground">
                          RUT: <HL text={r.rut} q={q} />
                        </span>
                      )}
                      {r.meta && r.meta !== r.rut && (
                        <span className="text-xs text-muted-foreground font-mono">
                          <HL text={r.meta} q={q} />
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Monto + chevron */}
                  <div className="flex items-center gap-3 shrink-0">
                    {r.monto != null && r.monto > 0 && (
                      <span className="text-sm font-semibold tabular-nums">
                        {formatMoney(r.monto, r.moneda ?? "CLP", r.decimales ?? 0)}
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
