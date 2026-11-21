import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { FileText, ChevronRight, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Loader2, AlertCircle, ArrowLeft, Package } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

interface DocumentoVenta {
  id: number | null;
  tipoDocumento: string;
  nombrePersonalizado: string | null;
  nombreDefault: string;
  activo: boolean;
  afectaStock: boolean;
  tipoMovimientoStock: "rebaja" | "aumenta";
}

async function fetchDocumentos(): Promise<DocumentoVenta[]> {
  const res = await fetch("/api/configuracion/ventas/documentos", { credentials: "include" });
  if (!res.ok) throw new Error("Error al cargar documentos");
  return res.json();
}

async function patchDocumento(tipoDocumento: string, body: Partial<Omit<DocumentoVenta, "id" | "tipoDocumento" | "nombreDefault">>) {
  const res = await fetch(`/api/configuracion/ventas/documentos/${encodeURIComponent(tipoDocumento)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Error al guardar");
  return res.json();
}

function DocumentoRow({ doc }: { doc: DocumentoVenta }) {
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState(doc.nombrePersonalizado ?? "");
  const [expanded, setExpanded] = useState(false);

  const mutation = useMutation({
    mutationFn: (body: Partial<Omit<DocumentoVenta, "id" | "tipoDocumento" | "nombreDefault">>) =>
      patchDocumento(doc.tipoDocumento, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configuracion-ventas-documentos"] });
      toast({ title: "Guardado", description: "Configuración actualizada." });
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudo guardar.", variant: "destructive" });
    },
  });

  const toggleActivo = () => mutation.mutate({ activo: !doc.activo });
  const toggleStock = () => {
    const nuevo = !doc.afectaStock;
    mutation.mutate({ afectaStock: nuevo });
    if (nuevo) setExpanded(true);
    else setExpanded(false);
  };
  const saveTipoMovimiento = (val: "rebaja" | "aumenta") => mutation.mutate({ tipoMovimientoStock: val });
  const saveNombre = () => {
    mutation.mutate({ nombrePersonalizado: nombre.trim() || null });
  };

  return (
    <div className={`border rounded-lg transition-colors ${doc.activo ? "bg-card" : "bg-muted/30"}`}>
      <div className="flex items-center gap-3 p-4">
        {/* Estado activo toggle */}
        <button
          onClick={toggleActivo}
          disabled={mutation.isPending}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title={doc.activo ? "Desactivar documento" : "Activar documento"}
        >
          {doc.activo
            ? <ToggleRight className="h-6 w-6 text-green-600" />
            : <ToggleLeft className="h-6 w-6 text-muted-foreground" />}
        </button>

        {/* Nombre */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-medium ${!doc.activo ? "text-muted-foreground line-through" : ""}`}>
              {doc.nombrePersonalizado || doc.nombreDefault}
            </span>
            {doc.nombrePersonalizado && (
              <Badge variant="outline" className="text-xs">Personalizado</Badge>
            )}
            {!doc.activo && (
              <Badge variant="secondary" className="text-xs">Inactivo</Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">{doc.tipoDocumento}</span>
        </div>

        {/* Stock badge */}
        {doc.afectaStock && (
          <Badge variant="outline" className="text-xs gap-1 shrink-0">
            <Package className="h-3 w-3" />
            {doc.tipoMovimientoStock === "rebaja" ? "Rebaja stock" : "Aumenta stock"}
          </Badge>
        )}

        {/* Expand */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-4">
          {/* Nombre personalizado */}
          <div className="space-y-1">
            <Label className="text-xs">Nombre personalizado</Label>
            <div className="flex gap-2">
              <Input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder={doc.nombreDefault}
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={saveNombre}
                disabled={mutation.isPending}
                className="h-8 shrink-0"
              >
                {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Guardar"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Dejar vacío para usar el nombre por defecto</p>
          </div>

          {/* Actualiza stock */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`stock-${doc.tipoDocumento}`}
                checked={doc.afectaStock}
                onChange={toggleStock}
                disabled={mutation.isPending}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor={`stock-${doc.tipoDocumento}`} className="text-sm cursor-pointer">
                Actualiza stock de artículos
              </Label>
            </div>

            {doc.afectaStock && (
              <div className="ml-6 space-y-1">
                <Label className="text-xs">Tipo de movimiento</Label>
                <Select
                  value={doc.tipoMovimientoStock}
                  onValueChange={(val) => saveTipoMovimiento(val as "rebaja" | "aumenta")}
                  disabled={mutation.isPending}
                >
                  <SelectTrigger className="h-8 text-sm w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rebaja">Rebaja stock (venta)</SelectItem>
                    <SelectItem value="aumenta">Aumenta stock (devolución / nota crédito)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConfiguracionVentasDocumentos() {
  const [, setLocation] = useLocation();

  const { data: documentos, isLoading, error } = useQuery({
    queryKey: ["configuracion-ventas-documentos"],
    queryFn: fetchDocumentos,
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-6 px-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <button onClick={() => setLocation("/configuracion/ventas")} className="hover:text-foreground transition-colors flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" />
          Ventas
        </button>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Configuración de Documento</span>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">Configuración de Documento</h1>
        <p className="text-muted-foreground mt-1">
          Personaliza el nombre, activa o desactiva documentos de venta, y configura el comportamiento de stock para cada uno.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 flex items-center gap-2 text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>Error al cargar documentos de venta.</span>
          </CardContent>
        </Card>
      )}

      {documentos && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Documentos de venta
            </CardTitle>
            <CardDescription>
              Haz clic en <ChevronDown className="inline h-3 w-3" /> para expandir y editar cada documento.
              Usa el toggle <ToggleRight className="inline h-4 w-4 text-green-600" /> para activar o desactivar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {documentos.map((doc) => (
              <DocumentoRow key={doc.tipoDocumento} doc={doc} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
