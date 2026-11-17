import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Loader2, FileSpreadsheet, ChevronRight, ArrowLeft, Trash2, AlertCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";

const currentYear = new Date().getFullYear();
const currentMonth = String(new Date().getMonth() + 1).padStart(2, "0");
const defaultPeriodo = `${currentYear}${currentMonth}`;

function fmt(n: number | null | undefined) {
  if (!n) return "0";
  return Math.abs(n).toLocaleString("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

interface Importacion {
  id: number;
  periodo: string;
  tipo: "compras" | "ventas" | "boletas";
  origenImportacion: string;
  importadoEn: string;
  totalNeto: string;
  totalIva: string;
  totalExento: string;
  totalBruto: string;
  notas: string | null;
}

const TIPO_COLORS: Record<string, string> = {
  compras: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  ventas: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  boletas: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
};

// Tipos de documento SII comunes en Chile
const TIPOS_DOC_SII: Record<number, string> = {
  33: "Factura Electrónica", 34: "Factura no Afecta o Exenta", 39: "Boleta Electrónica",
  41: "Boleta no Afecta o Exenta", 46: "Factura de Compra Electrónica", 52: "Guía de Despacho",
  56: "Nota de Débito", 61: "Nota de Crédito", 110: "Factura de Exportación", 112: "Nota de Crédito Exportación",
};

// ═══ DETALLE IMPORTACIÓN ═══
function ImportacionDetalle({ importacion, onBack, onDelete }: { importacion: Importacion; onBack: () => void; onDelete: () => void }) {
  const { data: documentos = [], isLoading } = useQuery({
    queryKey: ["sii-docs", importacion.id],
    queryFn: async () => {
      const res = await fetch(`/api/contabilidad/libro-sii/${importacion.id}/documentos`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json() as Promise<any[]>;
    },
  });

  const ESTADO_COLORS: Record<string, string> = {
    vigente: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    anulado: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    no_incluir: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    pendiente_sii: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${TIPO_COLORS[importacion.tipo]}`}>
              {importacion.tipo}
            </span>
            <h2 className="font-semibold">Período {importacion.periodo.substring(4, 6)}/{importacion.periodo.substring(0, 4)}</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Importado {format(new Date(importacion.importadoEn), "dd/MM/yyyy HH:mm")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onDelete} className="gap-1.5 text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
          Eliminar
        </Button>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-4 gap-3">
        <div className="border rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">Neto</p>
          <p className="font-semibold font-mono text-sm mt-0.5">$ {fmt(parseFloat(importacion.totalNeto))}</p>
        </div>
        <div className="border rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">IVA</p>
          <p className="font-semibold font-mono text-sm mt-0.5">$ {fmt(parseFloat(importacion.totalIva))}</p>
        </div>
        <div className="border rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground">Exento</p>
          <p className="font-semibold font-mono text-sm mt-0.5">$ {fmt(parseFloat(importacion.totalExento))}</p>
        </div>
        <div className="border rounded-lg p-3 text-center bg-muted/30">
          <p className="text-xs text-muted-foreground">Total Bruto</p>
          <p className="font-bold font-mono text-sm mt-0.5">$ {fmt(parseFloat(importacion.totalBruto))}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">Tipo Doc</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">Folio</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">Fecha</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">RUT</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">Razón Social</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground">Neto</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground">IVA</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground">Total</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">Estado</th>
              </tr>
            </thead>
            <tbody>
              {documentos.map((doc) => (
                <tr key={doc.id} className={`border-b hover:bg-muted/20 ${doc.estado === "anulado" ? "opacity-50" : ""}`}>
                  <td className="py-2 px-3 text-xs">
                    <span className="font-medium">{doc.tipoDoc}</span>
                    <br />
                    <span className="text-muted-foreground">{TIPOS_DOC_SII[doc.tipoDoc] ?? "Otro"}</span>
                  </td>
                  <td className="py-2 px-3 font-mono text-xs">{doc.folio}</td>
                  <td className="py-2 px-3 text-xs">{format(new Date(doc.fechaEmision + "T12:00:00"), "dd/MM/yy")}</td>
                  <td className="py-2 px-3 font-mono text-xs">{doc.rutContraparte}</td>
                  <td className="py-2 px-3 text-xs max-w-[180px] truncate" title={doc.razonSocial}>{doc.razonSocial}</td>
                  <td className="py-2 px-3 text-right font-mono text-xs">{doc.montoNeto ? fmt(parseFloat(doc.montoNeto)) : "—"}</td>
                  <td className="py-2 px-3 text-right font-mono text-xs">{doc.montoIva ? fmt(parseFloat(doc.montoIva)) : "—"}</td>
                  <td className="py-2 px-3 text-right font-mono text-xs font-medium">{fmt(parseFloat(doc.montoTotal))}</td>
                  <td className="py-2 px-3">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${ESTADO_COLORS[doc.estado] ?? ""}`}>
                      {doc.estado}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {documentos.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">Sin documentos en esta importación</div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══ MODAL IMPORTAR ═══
function ImportarModal({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    periodo: defaultPeriodo,
    tipo: "compras" as "compras" | "ventas" | "boletas",
    notas: "",
  });
  const [csvText, setCsvText] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      // Parse CSV manually (simple version)
      const lines = csvText.trim().split("\n").filter(Boolean);
      const headers = lines[0].split(";").map((h) => h.trim().toLowerCase());
      const documentos = lines.slice(1).map((line) => {
        const vals = line.split(";");
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = (vals[i] ?? "").trim().replace(/"/g, ""); });
        return {
          tipoDoc: parseInt(obj["tipo doc"] || obj["tipodoc"] || obj["tipo_doc"] || "33"),
          folio: parseInt(obj["folio"] || "0"),
          fechaEmision: obj["fecha"] || obj["fecha emision"] || obj["fecha_emision"] || new Date().toISOString().split("T")[0],
          rutContraparte: obj["rut"] || obj["rut contraparte"] || obj["rutcontraparte"] || "",
          razonSocial: obj["razon social"] || obj["razonsocial"] || obj["razon_social"] || "",
          montoNeto: parseFloat((obj["monto neto"] || obj["neto"] || "0").replace(/[^0-9.-]/g, "")) || 0,
          montoExento: parseFloat((obj["monto exento"] || obj["exento"] || "0").replace(/[^0-9.-]/g, "")) || 0,
          montoIva: parseFloat((obj["monto iva"] || obj["iva"] || "0").replace(/[^0-9.-]/g, "")) || 0,
          montoTotal: parseFloat((obj["monto total"] || obj["total"] || "0").replace(/[^0-9.-]/g, "")) || 0,
          ivaNoRecuperable: parseFloat((obj["iva no recuperable"] || "0").replace(/[^0-9.-]/g, "")) || 0,
          ivaUsoComun: parseFloat((obj["iva uso comun"] || "0").replace(/[^0-9.-]/g, "")) || 0,
          estado: "vigente",
        };
      });

      const totNeto = documentos.reduce((s, d) => s + d.montoNeto, 0);
      const totIva = documentos.reduce((s, d) => s + d.montoIva, 0);
      const totExento = documentos.reduce((s, d) => s + d.montoExento, 0);
      const totBruto = documentos.reduce((s, d) => s + d.montoTotal, 0);

      const res = await fetch("/api/contabilidad/libro-sii", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...form,
          origenImportacion: "manual_csv",
          documentos,
          totalNeto: totNeto,
          totalIva: totIva,
          totalExento: totExento,
          totalBruto: totBruto,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Error al importar");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Libro importado correctamente" });
      onSuccess();
      onClose();
      setCsvText("");
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar Libro de Compra/Venta</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Período (AAAAMM)</Label>
              <Input value={form.periodo} onChange={(e) => setForm((f) => ({ ...f, periodo: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de libro</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v as any }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="compras">Libro de Compras</SelectItem>
                  <SelectItem value="ventas">Libro de Ventas</SelectItem>
                  <SelectItem value="boletas">Libro de Boletas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Pegar CSV del SII</Label>
            <p className="text-xs text-muted-foreground">
              Columnas esperadas (separadas por punto y coma): <code className="bg-muted px-1 rounded">Tipo Doc;Folio;Fecha;RUT;Razon Social;Monto Neto;Monto Exento;Monto IVA;Monto Total</code>
            </p>
            <Textarea
              rows={8}
              placeholder={"Tipo Doc;Folio;Fecha;RUT;Razon Social;Monto Neto;Monto IVA;Monto Total\n33;100;2024-01-15;76.123.456-7;Empresa Ejemplo S.A.;1000000;190000;1190000"}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-sm text-blue-800 dark:text-blue-300">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Importación manual</p>
              <p className="text-xs mt-0.5">Próximamente: importación directa desde el SII mediante API autorizada. Por ahora, descarga el libro desde <strong>sii.cl → Mi SII → Libros de Compra y Venta</strong> y pega aquí.</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Input placeholder="Notas opcionales..." value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !csvText.trim() || !form.periodo}>
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Importar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══ COMPONENTE PRINCIPAL ═══
interface Props { hideHeader?: boolean }

export default function LibroSiiPage({ hideHeader }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Importacion | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [filtroPeriodo, setFiltroPeriodo] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");

  const { data: importaciones = [], isLoading } = useQuery({
    queryKey: ["libro-sii"],
    queryFn: async () => {
      const res = await fetch("/api/contabilidad/libro-sii", { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json() as Promise<Importacion[]>;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/contabilidad/libro-sii/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Error");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["libro-sii"] });
      setSelected(null);
      toast({ title: "Importación eliminada" });
    },
  });

  const filtered = importaciones.filter((i) => {
    if (filtroPeriodo && !i.periodo.includes(filtroPeriodo)) return false;
    if (filtroTipo !== "todos" && i.tipo !== filtroTipo) return false;
    return true;
  });

  if (selected) {
    return (
      <div className="space-y-5">
        {!hideHeader && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contabilidad</p>
            <h1 className="text-2xl font-bold tracking-tight">Libro Compra/Venta SII</h1>
          </div>
        )}
        <ImportacionDetalle
          importacion={selected}
          onBack={() => setSelected(null)}
          onDelete={() => {
            if (confirm("¿Eliminar esta importación y todos sus documentos?")) {
              deleteMutation.mutate(selected.id);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {!hideHeader && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Contabilidad</p>
          <h1 className="text-2xl font-bold tracking-tight">Libro Compra/Venta SII</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Importación y gestión de libros tributarios</p>
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-end justify-between">
        <div className="flex gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Período (AAAAMM)</Label>
            <Input className="w-32" placeholder="202401..." value={filtroPeriodo} onChange={(e) => setFiltroPeriodo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={filtroTipo} onValueChange={setFiltroTipo}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="compras">Compras</SelectItem>
                <SelectItem value="ventas">Ventas</SelectItem>
                <SelectItem value="boletas">Boletas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button size="sm" onClick={() => setModalOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Importar libro
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin importaciones</p>
          <p className="text-sm mt-1">Importa el libro desde el SII para registrar compras y ventas</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">Período</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">Tipo</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground">Neto</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground">IVA</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-muted-foreground">Total</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-muted-foreground">Importado</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((imp) => (
                <tr key={imp.id} className="border-b hover:bg-muted/20 cursor-pointer" onClick={() => setSelected(imp)}>
                  <td className="py-2.5 px-3 font-mono text-sm font-medium">
                    {imp.periodo.substring(4, 6)}/{imp.periodo.substring(0, 4)}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${TIPO_COLORS[imp.tipo]}`}>
                      {imp.tipo}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-sm">$ {fmt(parseFloat(imp.totalNeto))}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-sm">$ {fmt(parseFloat(imp.totalIva))}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-sm font-medium">$ {fmt(parseFloat(imp.totalBruto))}</td>
                  <td className="py-2.5 px-3 text-sm text-muted-foreground">
                    {format(new Date(imp.importadoEn), "dd/MM/yyyy")}
                  </td>
                  <td className="py-2.5 px-3">
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ImportarModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => qc.invalidateQueries({ queryKey: ["libro-sii"] })}
      />
    </div>
  );
}
