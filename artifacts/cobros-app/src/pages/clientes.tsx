import { useRef, useState } from "react";
import { Link } from "wouter";
import * as XLSX from "xlsx";
import {
  useListClientes,
  useCreateCliente,
  useImportarClientes,
  getListClientesQueryKey,
  useListAdminUsuarios,
  type AdminUsuario,
  type ImportarClientesResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@workspace/replit-auth-web";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Users, Search, Plus, Phone, Mail, ChevronRight, Loader2, ArrowUpRight, Shield, Download, Upload, Building2, CheckCircle2, AlertTriangle, SearchCheck } from "lucide-react";
import { useDebounce } from "@/hooks/use-debounce";
import { ScoreBadge } from "@/components/score-badge";
import { formatCurrency } from "@/lib/format";

// Validates Chilean RUT checksum
function validarRut(rut: string): boolean {
  const cleaned = rut.replace(/\./g, "").replace(/-/g, "").toLowerCase();
  if (!/^\d{7,8}[0-9k]$/.test(cleaned)) return false;
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  let sum = 0;
  let mult = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const expected = 11 - (sum % 11);
  const dvExpected = expected === 11 ? "0" : expected === 10 ? "k" : String(expected);
  return dv === dvExpected;
}

const clienteSchema = z.object({
  nombre: z.string().min(1, "La razón social / nombre es obligatorio").max(200),
  rut: z
    .string()
    .min(1, "El RUT es obligatorio")
    .refine(
      (v) => /^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/.test(v) || /^\d{7,8}-[\dkK]$/.test(v),
      "Formato inválido — usa 12.345.678-9"
    )
    .refine(validarRut, "El RUT no es válido (dígito verificador incorrecto)"),
  email: z
    .string()
    .min(1, "El email es obligatorio")
    .email("Email inválido"),
  telefono: z
    .string()
    .min(1, "El teléfono es obligatorio")
    .regex(
      /^\+56\s?9\s?\d{4}\s?\d{4}$/,
      "Formato inválido — usa +56 9 1234 5678"
    ),
  direccion: z.string().max(300).optional(),
  giro: z.string().max(300).optional(),
});
type ClienteForm = z.infer<typeof clienteSchema>;

// Autoformato RUT chileno mientras se escribe
function formatRutInput(value: string): string {
  const cleaned = value.replace(/[^0-9kK]/g, "").toUpperCase();
  if (cleaned.length < 2) return cleaned;
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  const bodyFormatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${bodyFormatted}-${dv}`;
}

function NuevoClienteDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [buscandoRut, setBuscandoRut] = useState(false);
  const { toast } = useToast();
  const createCliente = useCreateCliente();

  const buscarEnSii = async () => {
    const rut = form.getValues("rut");
    if (!rut || !validarRut(rut)) {
      toast({ title: "RUT inválido", description: "Ingresa un RUT válido antes de buscar.", variant: "destructive" });
      return;
    }
    setBuscandoRut(true);
    try {
      const res = await fetch(`/api/clientes/buscar-rut/${encodeURIComponent(rut)}`);
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "No encontrado", description: data.error ?? "No se encontró información en el SII.", variant: "destructive" });
        return;
      }
      // Autocomplete campos
      if (data.nombre) form.setValue("nombre", data.nombre, { shouldValidate: true });
      if (data.giro) form.setValue("giro", data.giro, { shouldValidate: true });
      toast({ title: "Datos obtenidos del SII", description: `${data.nombre}${data.giro ? ` · ${data.giro}` : ""}` });
    } catch {
      toast({ title: "Error", description: "No se pudo consultar el SII.", variant: "destructive" });
    } finally {
      setBuscandoRut(false);
    }
  };

  const form = useForm<ClienteForm>({
    resolver: zodResolver(clienteSchema),
    defaultValues: { nombre: "", rut: "", email: "", telefono: "", direccion: "", giro: "" },
  });

  const onSubmit = (values: ClienteForm) => {
    createCliente.mutate(
      { data: { nombre: values.nombre, rut: values.rut, email: values.email, telefono: values.telefono, direccion: values.direccion?.trim() || undefined, giro: values.giro?.trim() || undefined } },
      {
        onSuccess: () => {
          toast({ title: "Cliente creado", description: "El cliente fue creado exitosamente." });
          form.reset();
          setOpen(false);
          onCreated();
        },
        onError: () => {
          toast({ title: "Error", description: "No se pudo crear el cliente.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nuevo cliente
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Razón social / Nombre *</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Empresa S.A. o Juan Pérez" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="rut"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>RUT *</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input
                        placeholder="12.345.678-9"
                        className="font-mono"
                        {...field}
                        onChange={(e) => {
                          const formatted = formatRutInput(e.target.value);
                          field.onChange(formatted);
                        }}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-1.5 px-3"
                      disabled={true}
                      title="Búsqueda por RUT disponible próximamente (requiere certificación DTE)"
                    >
                      <SearchCheck className="h-4 w-4" />
                      <span className="hidden sm:inline">SII</span>
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email *</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="email@ejemplo.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="telefono"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teléfono *</FormLabel>
                    <FormControl>
                      <Input placeholder="+56 9 1234 5678" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="direccion"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Dirección (opcional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Av. Providencia 1234, Of. 502, Providencia" data-testid="input-direccion" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="giro"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Giro comercial (opcional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Ej: Construcción de obras civiles" maxLength={300} data-testid="input-giro" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={createCliente.isPending}>
                {createCliente.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creando...</> : "Crear cliente"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Importación masiva desde Excel ───────────────────────────────────────────
const PLANTILLA_HEADERS = ["Nombre", "Empresa (opcional)", "RUT", "Email", "Teléfono"];

function descargarPlantilla() {
  const ws = XLSX.utils.aoa_to_sheet([
    PLANTILLA_HEADERS,
    ["María Pérez González", "Comercial Andina SpA", "12.345.678-5", "maria.perez@ejemplo.cl", "+56 9 1234 5678"],
  ]);
  ws["!cols"] = [{ wch: 28 }, { wch: 24 }, { wch: 14 }, { wch: 28 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clientes");
  XLSX.writeFile(wb, "plantilla-clientes.xlsx");
}

function ImportarClientesButton({ onImported }: { onImported: () => void }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const importar = useImportarClientes();
  const [resultado, setResultado] = useState<ImportarClientesResult | null>(null);

  const handleFile = async (file: File) => {
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      // header:1 keeps positional columns so renamed headers still work.
      const rows = XLSX.utils.sheet_to_json<(string | number | undefined)[]>(ws, { header: 1 });
      const clientes = rows
        .slice(1) // skip header row
        .filter((r) => r && r.some((c) => String(c ?? "").trim() !== ""))
        .map((r) => ({
          nombre: String(r[0] ?? "").trim(),
          empresa: String(r[1] ?? "").trim(),
          rut: String(r[2] ?? "").trim(),
          email: String(r[3] ?? "").trim(),
          telefono: String(r[4] ?? "").trim(),
        }));
      if (clientes.length === 0) {
        toast({ title: "Archivo vacío", description: "El Excel no contiene filas de clientes.", variant: "destructive" });
        return;
      }
      if (clientes.length > 500) {
        toast({ title: "Demasiadas filas", description: "Máximo 500 clientes por importación.", variant: "destructive" });
        return;
      }
      importar.mutate(
        { data: { clientes } },
        {
          onSuccess: (res) => {
            setResultado(res);
            onImported();
          },
          onError: () => {
            toast({ title: "Error", description: "No se pudo importar el archivo.", variant: "destructive" });
          },
        },
      );
    } catch {
      toast({ title: "Archivo inválido", description: "No se pudo leer el Excel. Usa la plantilla.", variant: "destructive" });
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <Button variant="outline" size="sm" className="gap-1.5" onClick={descargarPlantilla}>
        <Download className="h-4 w-4" />
        Descargar plantilla Excel
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={importar.isPending}
        onClick={() => inputRef.current?.click()}
      >
        {importar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Importar clientes
      </Button>

      <Dialog open={resultado != null} onOpenChange={(o) => !o && setResultado(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resultado de la importación</DialogTitle>
          </DialogHeader>
          {resultado && (
            <div className="space-y-3 pt-1">
              <p className="text-sm">
                <CheckCircle2 className="inline h-4 w-4 text-emerald-500 mr-1.5 -mt-0.5" />
                <strong>{resultado.importados}</strong> cliente{resultado.importados !== 1 ? "s" : ""} importado{resultado.importados !== 1 ? "s" : ""} correctamente
                {resultado.omitidos.length > 0 && (
                  <>
                    , <strong>{resultado.omitidos.length}</strong> omitido{resultado.omitidos.length !== 1 ? "s" : ""} por duplicado o error
                  </>
                )}
                .
              </p>
              {resultado.omitidos.length > 0 && (
                <div className="max-h-56 overflow-y-auto rounded-lg border">
                  {resultado.omitidos.map((o, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs border-b last:border-b-0">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                      <span>
                        Fila {o.fila} — <strong>{o.nombre}</strong>: {o.motivo}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setResultado(null)}>Entendido</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatFecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

function SuscriptorEstadoBadge({ u }: { u: AdminUsuario }) {
  if (u.isAdmin) {
    return (
      <Badge variant="default" className="gap-1">
        <Shield className="h-3 w-3" />
        Admin
      </Badge>
    );
  }
  if (u.subscriptionStatus === "activa") return <Badge variant="default">Activa</Badge>;
  if (u.subscriptionStatus === "prueba") return <Badge variant="secondary">Prueba</Badge>;
  return <Badge variant="destructive">Vencida</Badge>;
}

function AdminSuscriptoresView() {
  const [search, setSearch] = useState("");
  const { data: usuarios, isLoading } = useListAdminUsuarios();

  const term = search.trim().toLowerCase();
  const filtrados = (usuarios ?? []).filter((u) => {
    if (!term) return true;
    return (
      (u.nombre ?? "").toLowerCase().includes(term) ||
      (u.email ?? "").toLowerCase().includes(term)
    );
  });

  return (
    <>
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-start gap-3">
        <Shield className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-foreground">Vista de administrador — Suscriptores de la plataforma</p>
          <p className="text-muted-foreground mt-0.5">
            Estás viendo todos los usuarios registrados en NextCob, no tu cartera de cobranza.
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar suscriptor por nombre o email..."
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Cargando suscriptores...
        </div>
      ) : filtrados.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
            <Users className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Sin resultados</h3>
          <p className="text-muted-foreground text-sm max-w-xs">
            No se encontraron suscriptores para tu búsqueda.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtrados.map((u) => (
            <Card key={u.id} className="shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                    {(u.nombre || u.email || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm truncate">{u.nombre || "Sin nombre"}</p>
                      <SuscriptorEstadoBadge u={u} />
                    </div>
                    <div className="flex flex-col gap-0.5 mt-1.5">
                      {u.email && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="truncate">{u.email}</span>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Registrado: {formatFecha(u.createdAt)}
                      </p>
                      {!u.isAdmin && (
                        <p className="text-xs text-muted-foreground">
                          Vence: {formatFecha(u.vencimiento)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export default function ClientesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [vista, setVista] = useState<"mios" | "suscriptores">("mios");

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const queryClient = useQueryClient();

  const { data: clientes, isLoading } = useListClientes(
    debouncedSearch ? { q: debouncedSearch } : undefined
  );

  const handleCreated = () => {
    queryClient.invalidateQueries({ queryKey: getListClientesQueryKey() });
  };

  if (isAdmin && vista === "suscriptores") {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Clientes</h1>
            <p className="text-muted-foreground mt-1">Gestiona tu cartera de clientes y su historial de cobros.</p>
          </div>
        </div>

        <div className="inline-flex rounded-lg border p-1 bg-card">
          <button
            onClick={() => setVista("mios")}
            className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Mis clientes
          </button>
          <button
            onClick={() => setVista("suscriptores")}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground"
          >
            Suscriptores (admin)
          </button>
        </div>

        <AdminSuscriptoresView />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clientes</h1>
          <p className="text-muted-foreground mt-1">Gestiona tu cartera de clientes y su historial de cobros.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ImportarClientesButton onImported={handleCreated} />
          <NuevoClienteDialog onCreated={handleCreated} />
        </div>
      </div>

      {isAdmin && (
        <div className="inline-flex rounded-lg border p-1 bg-card">
          <button
            onClick={() => setVista("mios")}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-primary text-primary-foreground"
          >
            Mis clientes
          </button>
          <button
            onClick={() => setVista("suscriptores")}
            className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Suscriptores (admin)
          </button>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o RUT..."
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-8 bg-muted/50 rounded-t-lg" />
              <CardContent className="h-12 bg-muted/20" />
            </Card>
          ))}
        </div>
      ) : !clientes || clientes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
            <Users className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">
            {search ? "Sin resultados" : "Sin clientes aún"}
          </h3>
          <p className="text-muted-foreground text-sm max-w-xs">
            {search
              ? `No se encontraron clientes para "${search}".`
              : "Crea tu primer cliente para asociarlo a cobros y ver su historial."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clientes.map((cliente) => (
            <Link key={cliente.id} href={`/clientes/${cliente.id}`}>
              <Card className="shadow-sm hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                        {cliente.nombre.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">{cliente.nombre}</p>
                        {cliente.empresa && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <Building2 className="h-3 w-3 shrink-0" />
                            <span className="truncate">{cliente.empresa}</span>
                          </div>
                        )}
                        {cliente.rut && (
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">{cliente.rut}</p>
                        )}
                        <div className="flex flex-col gap-0.5 mt-1.5">
                          {cliente.email && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Mail className="h-3 w-3 shrink-0" />
                              <span className="truncate">{cliente.email}</span>
                            </div>
                          )}
                          {cliente.telefono && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Phone className="h-3 w-3 shrink-0" />
                              <span>{cliente.telefono}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      <ScoreBadge score={cliente.score} categoria={cliente.categoria} size="xs" />
                    </div>
                  </div>
                  {cliente.totalPendiente > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Pendiente:{" "}
                      <span className="font-semibold text-foreground">{formatCurrency(cliente.totalPendiente)}</span>
                      {cliente.cobrosVencidos > 0 && (
                        <span className="ml-1.5 text-red-600">
                          · {cliente.cobrosVencidos} vencido{cliente.cobrosVencidos !== 1 ? "s" : ""}
                        </span>
                      )}
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
