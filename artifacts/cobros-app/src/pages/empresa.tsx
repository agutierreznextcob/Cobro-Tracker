import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import {
  useGetEmpresa,
  getGetEmpresaQueryKey,
  useSaveEmpresa,
  useRequestEmpresaLogoUpload,
  useGetEmpresaLogo,
  getGetEmpresaLogoQueryKey,
  type Empresa,
  type EmpresaPlantilla,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PlantillaMiniatura } from "@/components/plantilla-miniatura";
import { formatRut, isValidRut } from "@/lib/rut";
import { apiErrorMessage } from "@/lib/inventario";
import { Building2, Check, ImagePlus, Loader2, Lock, Palette, RotateCw, Save, Trash2, Undo2 } from "lucide-react";

const VACIA: Empresa = {
  razonSocial: "", rut: "", giro: "", direccion: "", ciudad: "", telefono: "", email: "", sitioWeb: "",
  piePagina: "", condicionesPago: "", validezDias: 30, colorPrimario: "#2563EB", plantilla: "clasica", logoPath: null,
};
const MAX_LOGO = 2 * 1024 * 1024;
const COLORES = ["#2563EB", "#0F766E", "#B45309", "#BE123C", "#4338CA", "#1F2937"];

const PLANTILLAS: { id: EmpresaPlantilla; nombre: string; desc: string }[] = [
  { id: "clasica", nombre: "Clásica Chile", desc: "Sobria y neutra. Título con banda gris, tabla oscura con filas alternadas." },
  { id: "moderna", nombre: "Moderna minimalista", desc: "Franja de tu color con logo blanco, tabla limpia y totales destacados." },
  { id: "bicolor", nombre: "Profesional bicolor", desc: "Encabezado dividido, estado del documento y condiciones en recuadro." },
];

type LogoStage = { kind: "keep" } | { kind: "new"; file: File; url: string } | { kind: "remove" };

function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs font-medium">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Section({ n, title, desc, children }: { n: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 sm:p-6 shadow-sm">
      <div className="flex gap-3 mb-5">
        <span className="font-mono text-[11px] text-primary pt-0.5">{n}</span>
        <div>
          <h2 className="font-semibold leading-tight">{title}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
        </div>
      </div>
      {children}
    </Card>
  );
}

export default function EmpresaPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const puedeEditar = !user?.orgRole || user.orgRole === "admin_org";

  const { data, isLoading, isError, refetch, isFetching } = useGetEmpresa({ query: { queryKey: getGetEmpresaQueryKey(), staleTime: 0, refetchOnMount: "always" } });
  const save = useSaveEmpresa();
  const pedirUpload = useRequestEmpresaLogoUpload();

  const [f, setF] = useState<Empresa>(VACIA);
  const [validez, setValidez] = useState("30");
  const [logo, setLogo] = useState<LogoStage>({ kind: "keep" });
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const init = useRef(false);

  useEffect(() => {
    if (!data || init.current) return;
    init.current = true;
    setF(data);
    setValidez(String(data.validezDias));
  }, [data]);

  const logoPath = data?.logoPath ?? null;
  const logoQ = useGetEmpresaLogo({
    query: { queryKey: [...getGetEmpresaLogoQueryKey(), logoPath], enabled: !!logoPath, staleTime: Infinity },
    request: { cache: "no-store" },
  });
  const [persistUrl, setPersistUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!logoQ.data || !logoPath) { setPersistUrl(null); return; }
    const u = URL.createObjectURL(logoQ.data);
    setPersistUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [logoQ.data, logoPath]);

  // Revoke the staged local preview when replaced or on unmount.
  useEffect(() => () => { if (logo.kind === "new") URL.revokeObjectURL(logo.url); }, [logo]);

  const logoUrl = logo.kind === "new" ? logo.url : logo.kind === "remove" ? null : persistUrl;
  const set = <K extends keyof Empresa>(k: K, v: Empresa[K]) => setF((p) => ({ ...p, [k]: v }));

  const validezN = Number(validez);
  const errores = useMemo(() => {
    const e: Partial<Record<string, string>> = {};
    if (!f.razonSocial.trim()) e.razonSocial = "Requerido para tus documentos.";
    if (f.rut.trim() && !isValidRut(f.rut)) e.rut = "RUT inválido.";
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = "Email inválido.";
    if (!Number.isInteger(validezN) || validezN < 1 || validezN > 3650) e.validez = "Entre 1 y 3650 días.";
    if (!/^#[0-9A-Fa-f]{6}$/.test(f.colorPrimario)) e.color = "Usa formato #RRGGBB.";
    return e;
  }, [f, validezN]);
  const valido = Object.keys(errores).length === 0;
  const sucio = !!data && (logo.kind !== "keep" || JSON.stringify({ ...f, validezDias: validezN }) !== JSON.stringify(data));
  const ocupado = subiendo || save.isPending;

  const elegirArchivo = (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) { toast({ title: "Formato no soportado", description: "Sube un PNG o JPG.", variant: "destructive" }); return; }
    if (file.size > MAX_LOGO) { toast({ title: "Archivo muy pesado", description: "El logo debe pesar como máximo 2 MB.", variant: "destructive" }); return; }
    setLogo({ kind: "new", file, url: URL.createObjectURL(file) });
  };

  const guardar = async () => {
    if (!puedeEditar || !valido || ocupado) return;
    setSubiendo(logo.kind === "new");
    try {
      let nuevoPath: string | null = data?.logoPath ?? null;
      if (logo.kind === "remove") nuevoPath = null;
      if (logo.kind === "new") {
        const up = await pedirUpload.mutateAsync({ data: { contentType: logo.file.type as "image/png" | "image/jpeg", size: logo.file.size } });
        const put = await fetch(up.uploadURL, { method: "PUT", body: logo.file, headers: { "Content-Type": logo.file.type } });
        if (!put.ok) throw new Error("No se pudo subir el logo. Intenta nuevamente.");
        nuevoPath = up.objectPath;
      }
      setSubiendo(false);
      const body: Empresa = {
        ...f,
        rut: f.rut.trim() ? formatRut(f.rut) : "",
        razonSocial: f.razonSocial.trim(),
        email: f.email.trim(),
        sitioWeb: f.sitioWeb.trim(),
        validezDias: validezN,
        colorPrimario: f.colorPrimario.toUpperCase(),
        logoPath: nuevoPath,
      };
      const res = await save.mutateAsync({ data: body });
      qc.setQueryData(getGetEmpresaQueryKey(), res);
      qc.invalidateQueries({ queryKey: getGetEmpresaQueryKey() });
      qc.invalidateQueries({ queryKey: getGetEmpresaLogoQueryKey() });
      setF(res);
      setValidez(String(res.validezDias));
      setLogo({ kind: "keep" });
      toast({ title: "Perfil de empresa guardado", description: "Tus próximos PDFs usarán estos datos." });
    } catch (err) {
      toast({ title: "No se pudo guardar", description: apiErrorMessage(err, "Revisa los datos e intenta nuevamente."), variant: "destructive" });
    } finally {
      setSubiendo(false);
    }
  };

  const descartar = () => {
    if (!data) return;
    setF(data);
    setValidez(String(data.validezDias));
    setLogo({ kind: "keep" });
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto space-y-4 animate-pulse">
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <div className="space-y-4">{[0, 1, 2].map((i) => <div key={i} className="h-56 bg-muted/60 rounded-xl" />)}</div>
          <div className="h-[420px] bg-muted/60 rounded-xl" />
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="max-w-md mx-auto text-center py-16 space-y-3">
        <Building2 className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="font-medium">No pudimos cargar el perfil de tu empresa.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RotateCw className="h-4 w-4 mr-1.5" />Reintentar</Button>
      </div>
    );
  }

  const ro = !puedeEditar || ocupado;

  return (
    <div className="max-w-7xl mx-auto space-y-5 animate-in fade-in duration-300 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Configuración</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Perfil de empresa</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">Estos datos aparecen en todas tus cotizaciones y cobros en PDF. Moneda e IVA se ajustan en <Link href="/configuracion/preferencias" className="text-primary hover:underline">Preferencias</Link>.</p>
        </div>
      </div>

      {!puedeEditar && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-200" data-testid="status-solo-lectura">
          <Lock className="h-4 w-4 shrink-0" />Solo el administrador de la organización puede modificar el perfil de empresa.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_300px] items-start">
        <div className="space-y-5 min-w-0">
          <Section n="01" title="Identidad" desc="Logo y datos tributarios del emisor.">
            <div className="flex flex-col sm:flex-row gap-5">
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={ro}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (!ro) elegirArchivo(e.dataTransfer.files?.[0]); }}
                  className="group relative h-32 w-full sm:w-44 rounded-lg border-2 border-dashed border-border bg-[repeating-conic-gradient(hsl(var(--muted))_0_25%,transparent_0_50%)] bg-[length:14px_14px] flex items-center justify-center overflow-hidden transition-colors hover:border-primary/60 disabled:cursor-not-allowed disabled:hover:border-border"
                  data-testid="button-logo-upload"
                >
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo de la empresa" className="max-h-[85%] max-w-[85%] object-contain" data-testid="img-logo" />
                  ) : logoQ.isLoading && logoPath && logo.kind === "keep" ? (
                    <div className="h-16 w-24 bg-muted rounded animate-pulse" />
                  ) : (
                    <span className="flex flex-col items-center gap-1.5 text-muted-foreground bg-card/90 rounded-md px-3 py-2">
                      <ImagePlus className="h-5 w-5" />
                      <span className="text-xs font-medium">Subir logo</span>
                    </span>
                  )}
                  {subiendo && <span className="absolute inset-0 bg-card/70 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></span>}
                </button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { elegirArchivo(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-logo-file" />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {logo.kind !== "keep" && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setLogo({ kind: "keep" })} disabled={ocupado} data-testid="button-logo-deshacer"><Undo2 className="h-3 w-3 mr-1" />Deshacer</Button>
                  )}
                  {(logo.kind === "new" || (logo.kind === "keep" && logoPath)) && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-red-600" onClick={() => setLogo({ kind: "remove" })} disabled={ro} data-testid="button-logo-quitar"><Trash2 className="h-3 w-3 mr-1" />Quitar</Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 max-w-44">PNG o JPG, máx. 2 MB. Un PNG con fondo transparente se ve mejor sobre color.</p>
                {logo.kind === "new" && <p className="text-[11px] text-primary mt-1">Se subirá al guardar.</p>}
                {logo.kind === "remove" && <p className="text-[11px] text-amber-700 mt-1">Se quitará al guardar.</p>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 flex-1 min-w-0">
                <Field label="Razón social / Nombre del negocio" className="sm:col-span-2">
                  <Input value={f.razonSocial} maxLength={200} onChange={(e) => set("razonSocial", e.target.value)} disabled={ro} placeholder="Comercial Los Aromos SpA" data-testid="input-razon-social" />
                  {errores.razonSocial && <p className="text-[11px] text-red-600">{errores.razonSocial}</p>}
                </Field>
                <Field label="RUT">
                  <Input value={f.rut} maxLength={20} onChange={(e) => set("rut", formatRut(e.target.value))} disabled={ro} placeholder="76.543.210-K" className="font-mono" data-testid="input-rut" />
                  {errores.rut && <p className="text-[11px] text-red-600">{errores.rut}</p>}
                </Field>
                <Field label="Giro comercial">
                  <Input value={f.giro} maxLength={300} onChange={(e) => set("giro", e.target.value)} disabled={ro} placeholder="Venta de materiales de construcción" data-testid="input-giro" />
                </Field>
              </div>
            </div>
          </Section>

          <Section n="02" title="Contacto" desc="Dirección y canales que verá tu cliente en el encabezado y pie.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Dirección"><Input value={f.direccion} maxLength={300} onChange={(e) => set("direccion", e.target.value)} disabled={ro} placeholder="Av. Matta 1234, Of. 3" data-testid="input-direccion" /></Field>
              <Field label="Ciudad / Comuna"><Input value={f.ciudad} maxLength={100} onChange={(e) => set("ciudad", e.target.value)} disabled={ro} placeholder="Santiago" data-testid="input-ciudad" /></Field>
              <Field label="Teléfono"><Input value={f.telefono} maxLength={50} onChange={(e) => set("telefono", e.target.value)} disabled={ro} placeholder="+56 9 1234 5678" data-testid="input-telefono" /></Field>
              <Field label="Email de contacto">
                <Input type="email" value={f.email} maxLength={254} onChange={(e) => set("email", e.target.value)} disabled={ro} placeholder="ventas@tuempresa.cl" data-testid="input-email" />
                {errores.email && <p className="text-[11px] text-red-600">{errores.email}</p>}
              </Field>
              <Field label="Sitio web (opcional)" className="sm:col-span-2"><Input value={f.sitioWeb} maxLength={300} onChange={(e) => set("sitioWeb", e.target.value)} disabled={ro} placeholder="www.tuempresa.cl" data-testid="input-sitio-web" /></Field>
            </div>
          </Section>

          <Section n="03" title="Condiciones por defecto" desc="Se precargan en cada cotización nueva; puedes cambiarlas en cada documento.">
            <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
              <Field label="Condiciones de pago"><Textarea value={f.condicionesPago} maxLength={2000} onChange={(e) => set("condicionesPago", e.target.value)} disabled={ro} placeholder="50% anticipo, 50% contra entrega. Transferencia bancaria." className="resize-none h-24" data-testid="input-condiciones-pago" /></Field>
              <Field label="Validez de cotización" hint="Días desde la emisión.">
                <div className="relative"><Input type="number" min={1} max={3650} value={validez} onChange={(e) => setValidez(e.target.value)} disabled={ro} className="font-mono pr-12" data-testid="input-validez-dias" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">días</span></div>
                {errores.validez && <p className="text-[11px] text-red-600">{errores.validez}</p>}
              </Field>
              <Field label="Pie de página personalizado" hint="Agradecimientos, garantías o datos bancarios. Aparece al final de cada PDF." className="sm:col-span-2">
                <Textarea value={f.piePagina} maxLength={2000} onChange={(e) => set("piePagina", e.target.value)} disabled={ro} placeholder="Gracias por confiar en nosotros." className="resize-none h-20" data-testid="input-pie-pagina" />
              </Field>
            </div>
          </Section>

          <Section n="04" title="Plantilla de documentos" desc="Elige el diseño de tus PDFs. El color primario se aplica en las plantillas Moderna y Bicolor.">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3" role="radiogroup">
              {PLANTILLAS.map((p) => {
                const sel = f.plantilla === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    disabled={ro}
                    onClick={() => set("plantilla", p.id)}
                    className={`group text-left rounded-xl border p-3 transition-all disabled:cursor-not-allowed ${sel ? "border-primary ring-2 ring-primary/25 bg-primary/[0.03]" : "hover:border-foreground/25 hover:bg-muted/30"}`}
                    data-testid={`option-plantilla-${p.id}`}
                  >
                    <div className="bg-[hsl(215_20%_93%)] dark:bg-muted rounded-lg p-4 mb-3">
                      <div className="mx-auto max-w-[150px] transition-transform duration-300 group-hover:-translate-y-0.5">
                        <PlantillaMiniatura plantilla={p.id} color={f.colorPrimario} logoUrl={logoUrl} nombre={f.razonSocial} />
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">{p.nombre}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{p.desc}</p>
                      </div>
                      <span className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border flex items-center justify-center ${sel ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>{sel && <Check className="h-3 w-3" />}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 pt-5 border-t flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex items-center gap-2 text-sm font-medium"><Palette className="h-4 w-4 text-muted-foreground" />Color primario</div>
              <div className="flex flex-wrap items-center gap-2">
                {COLORES.map((c) => (
                  <button key={c} type="button" disabled={ro} onClick={() => set("colorPrimario", c)} className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-card transition-transform hover:scale-110 disabled:hover:scale-100 ${f.colorPrimario.toUpperCase() === c ? "ring-2 ring-foreground/60" : ""}`} style={{ background: c }} aria-label={`Color ${c}`} data-testid={`swatch-color-${c.slice(1)}`} />
                ))}
                <label className={`relative h-7 w-7 rounded-full border-2 border-dashed border-border overflow-hidden ${ro ? "opacity-50" : "cursor-pointer"}`} title="Color personalizado">
                  <input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(f.colorPrimario) ? f.colorPrimario : "#2563EB"} onChange={(e) => set("colorPrimario", e.target.value.toUpperCase())} disabled={ro} className="absolute inset-0 opacity-0 cursor-pointer" data-testid="input-color-picker" />
                  <span className="absolute inset-1 rounded-full" style={{ background: "conic-gradient(#ef4444,#f59e0b,#22c55e,#06b6d4,#6366f1,#ec4899,#ef4444)" }} />
                </label>
                <Input value={f.colorPrimario} onChange={(e) => set("colorPrimario", e.target.value.trim())} disabled={ro} maxLength={7} className="h-8 w-28 font-mono text-xs uppercase" data-testid="input-color-hex" />
                <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => set("colorPrimario", "#2563EB")} disabled={ro}>Restablecer</Button>
              </div>
              {errores.color && <p className="text-[11px] text-red-600">{errores.color}</p>}
            </div>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-4 space-y-3">
          <Card className="p-5 shadow-sm bg-[hsl(215_20%_95%)] dark:bg-muted/40 border-dashed">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Así se verá</p>
            <div className="mx-auto max-w-[230px]">
              <PlantillaMiniatura plantilla={f.plantilla} color={/^#[0-9A-Fa-f]{6}$/.test(f.colorPrimario) ? f.colorPrimario : "#2563EB"} logoUrl={logoUrl} nombre={f.razonSocial} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 text-center">Esquema referencial. Usa "Vista previa" en una cotización o cobro para ver el PDF real.</p>
          </Card>
          {puedeEditar && (
            <Card className="p-4 shadow-sm space-y-2 hidden lg:block">
              <Button className="w-full" onClick={guardar} disabled={!sucio || !valido || ocupado} data-testid="button-guardar-empresa">
                {ocupado ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}{subiendo ? "Subiendo logo..." : save.isPending ? "Guardando..." : "Guardar cambios"}
              </Button>
              <Button variant="ghost" className="w-full" onClick={descartar} disabled={!sucio || ocupado}>Descartar</Button>
            </Card>
          )}
        </aside>
      </div>

      {puedeEditar && sucio && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-card/95 backdrop-blur px-4 py-3 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={descartar} disabled={ocupado}>Descartar</Button>
          <Button className="flex-1" onClick={guardar} disabled={!valido || ocupado} data-testid="button-guardar-empresa-mobile">
            {ocupado ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Guardar
          </Button>
        </div>
      )}
    </div>
  );
}
