import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import type { Producto } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { buscarPorCodigo } from "@/lib/inventario";
import { AlertCircle, Keyboard, Plus, ScanBarcode, ScanLine, X } from "lucide-react";

export type ScanOrigen = "pistola" | "manual";

/** Detection: more than 4 chars typed within 100 ms, then Enter = scanner gun. Anything slower is manual. */
const SCAN_MIN_CHARS = 4;
const SCAN_WINDOW_MS = 100;

/**
 * Reusable barcode input. Calls onScan on Enter (gun or manual). If onScan returns true
 * the field is cleared and refocused for consecutive scans.
 */
export function BarcodeScanner({
  onScan,
  label = "Escanear código de barras",
  autoActivate = true,
  testId = "scanner",
}: {
  onScan: (code: string, origen: ScanOrigen) => boolean;
  label?: string;
  autoActivate?: boolean;
  testId?: string;
}) {
  const [activo, setActivo] = useState(autoActivate);
  const [valor, setValor] = useState("");
  const [ultimo, setUltimo] = useState<ScanOrigen | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const firstKeyAt = useRef<number | null>(null);
  const typedCharacters = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => { if (activo) ref.current?.focus(); }, [activo]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const code = valor.trim();
      const elapsed = firstKeyAt.current == null ? Infinity : performance.now() - firstKeyAt.current;
      const count = typedCharacters.current;
      firstKeyAt.current = null;
      typedCharacters.current = 0;
      if (!code) return;
      const origen: ScanOrigen = count > SCAN_MIN_CHARS && code.length > SCAN_MIN_CHARS && elapsed < SCAN_WINDOW_MS ? "pistola" : "manual";
      setUltimo(origen);
      if (onScanRef.current(code, origen)) {
        setValor("");
        requestAnimationFrame(() => ref.current?.focus());
      }
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (valor === "" || firstKeyAt.current == null) {
        firstKeyAt.current = performance.now();
        typedCharacters.current = 0;
      }
      typedCharacters.current += 1;
    }
  };

  if (!activo) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setActivo(true)} data-testid={`button-activar-${testId}`}>
        <ScanBarcode className="h-4 w-4 mr-1.5" />{label}
      </Button>
    );
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        <ScanLine className="absolute left-3 top-2.5 h-4 w-4 text-primary" />
        <Input
          ref={ref}
          value={valor}
          onChange={(e) => { setValor(e.target.value); if (e.target.value === "") { firstKeyAt.current = null; typedCharacters.current = 0; } }}
          onKeyDown={onKeyDown}
          placeholder={label}
          className="pl-9 pr-9 font-mono border-primary/40 focus-visible:ring-primary/40"
          autoComplete="off"
          data-testid={`input-${testId}`}
        />
        <button type="button" onClick={() => { setActivo(false); setValor(""); }} className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Desactivar escáner" data-testid={`button-desactivar-${testId}`}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5" data-testid={`text-${testId}-origen`}>
        {ultimo === "pistola" ? <><ScanBarcode className="h-3 w-3" />Lectura detectada desde pistola</> : ultimo === "manual" ? <><Keyboard className="h-3 w-3" />Búsqueda manual con Enter</> : "Escanea con la pistola o escribe el código y presiona Enter."}
      </p>
    </div>
  );
}

/**
 * Scanner + exact lookup on barcode / SKU / internal code, with disambiguation,
 * not-found message and create link prefilled with the scanned code.
 */
export function ScanLookup({
  productos,
  onSelect,
  label,
  testId = "scanner",
  autoActivate = true,
  allowCreate = true,
}: {
  productos: Producto[] | undefined;
  onSelect: (p: Producto) => void;
  label?: string;
  testId?: string;
  autoActivate?: boolean;
  allowCreate?: boolean;
}) {
  const [noEncontrado, setNoEncontrado] = useState<string | null>(null);
  const [opciones, setOpciones] = useState<Producto[]>([]);
  const lookupRef = useRef<HTMLDivElement>(null);

  const onScan = (code: string) => {
    if (!productos) return false;
    const m = buscarPorCodigo(productos, code);
    setNoEncontrado(null); setOpciones([]);
    if (m.length === 0) { setNoEncontrado(code); return false; }
    if (m.length > 1) { setOpciones(m); return true; }
    onSelect(m[0]);
    return true;
  };

  return (
    <div className="space-y-2" ref={lookupRef}>
      <BarcodeScanner onScan={onScan} label={label} testId={testId} autoActivate={autoActivate} />
      {noEncontrado && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid={`text-${testId}-no-encontrado`}>
          <span className="flex items-center gap-1.5"><AlertCircle className="h-4 w-4" />Producto no encontrado — ¿desea crearlo? <span className="font-mono text-xs">({noEncontrado})</span></span>
          <span className="flex gap-1">
            {allowCreate && (
              <Button asChild size="sm" variant="outline" className="h-7 bg-background">
                <Link href={`/inventario/nuevo?codigoBarras=${encodeURIComponent(noEncontrado)}`} data-testid={`link-${testId}-crear`}><Plus className="h-3.5 w-3.5 mr-1" />Crear</Link>
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setNoEncontrado(null)}>Cerrar</Button>
          </span>
        </div>
      )}
      {opciones.length > 1 && (
        <div className="rounded-md border bg-card p-2 space-y-1" data-testid={`list-${testId}-opciones`}>
          <p className="px-1 text-xs text-muted-foreground">Este código coincide con {opciones.length} ítems. Elige uno:</p>
          {opciones.map((p) => (
            <button key={p.id} type="button" onClick={() => {
              setOpciones([]); onSelect(p);
              requestAnimationFrame(() => lookupRef.current?.querySelector("input")?.focus());
            }}
              className="w-full flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted" data-testid={`button-${testId}-opcion-${p.id}`}>
              <span className="truncate font-medium">{p.nombre}</span>
              <span className="font-mono text-[11px] text-muted-foreground shrink-0">{[p.codigoInterno, p.sku, p.codigoBarras].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
