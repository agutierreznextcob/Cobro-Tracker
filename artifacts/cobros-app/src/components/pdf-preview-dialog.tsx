import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiErrorMessage } from "@/lib/inventario";
import { AlertTriangle, Download, ExternalLink, FileText, RotateCw } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Fetches the PDF bytes through the authenticated API client. */
  cargar: () => Promise<Blob>;
  filename: string;
  titulo: string;
};

/**
 * Shows the exact PDF the server generates. The same blob is used for the
 * preview and the download, and the object URL is revoked on close.
 */
export function PdfPreviewDialog({ open, onOpenChange, cargar, filename, titulo }: Props) {
  const isMobile = useIsMobile();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    let creado: string | null = null;
    setUrl(null);
    setError(null);
    cargarRef.current()
      .then((blob) => {
        if (!vivo) return;
        const pdf = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
        creado = URL.createObjectURL(pdf);
        setUrl(creado);
      })
      .catch((err) => vivo && setError(apiErrorMessage(err, "No se pudo generar el PDF.")));
    return () => {
      vivo = false;
      if (creado) URL.revokeObjectURL(creado);
    };
  }, [open, intento]);

  const descargar = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[calc(100vw-1.5rem)] p-0 gap-0 overflow-hidden" data-testid="dialog-pdf-preview">
        <DialogHeader className="px-5 py-3.5 border-b bg-muted/30 flex-row items-center justify-between space-y-0 gap-3 pr-12">
          <div className="min-w-0">
            <DialogTitle className="text-base truncate">{titulo}</DialogTitle>
            <DialogDescription className="text-xs">Vista previa A4 del documento que recibirá tu cliente.</DialogDescription>
          </div>
          <Button size="sm" onClick={descargar} disabled={!url} data-testid="button-pdf-descargar">
            <Download className="h-4 w-4 mr-1.5" />Descargar
          </Button>
        </DialogHeader>
        <div className="bg-[hsl(215_20%_92%)] dark:bg-muted/40 h-[min(78dvh,860px)] flex items-center justify-center">
          {error ? (
            <div className="text-center space-y-3 px-6" data-testid="status-pdf-error">
              <AlertTriangle className="h-8 w-8 mx-auto text-amber-600" />
              <p className="text-sm font-medium">{error}</p>
              <Button variant="outline" size="sm" onClick={() => setIntento((n) => n + 1)} data-testid="button-pdf-reintentar">
                <RotateCw className="h-4 w-4 mr-1.5" />Reintentar
              </Button>
            </div>
          ) : !url ? (
            <div className="w-[min(420px,80%)] aspect-[210/297] bg-card rounded-sm shadow-lg p-6 space-y-3 animate-pulse" aria-label="Generando PDF">
              <div className="flex justify-between"><div className="h-8 w-20 bg-muted rounded" /><div className="space-y-1.5"><div className="h-2.5 w-28 bg-muted rounded" /><div className="h-2 w-20 bg-muted rounded ml-auto" /></div></div>
              <div className="h-5 bg-muted rounded" />
              <div className="h-12 bg-muted/70 rounded" />
              {Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-2.5 bg-muted/60 rounded" />)}
              <div className="h-10 w-1/2 ml-auto bg-muted rounded" />
            </div>
          ) : isMobile ? (
            <div className="text-center space-y-4 px-6" data-testid="pdf-mobile-fallback">
              <div className="mx-auto h-16 w-12 rounded-sm bg-card shadow flex items-center justify-center"><FileText className="h-6 w-6 text-primary" /></div>
              <p className="text-sm text-muted-foreground">Tu PDF está listo. En el teléfono se abre con el visor del sistema.</p>
              <div className="flex flex-col gap-2">
                <Button onClick={() => window.open(url, "_blank", "noopener")} data-testid="button-pdf-abrir"><ExternalLink className="h-4 w-4 mr-1.5" />Abrir PDF</Button>
                <Button variant="outline" onClick={descargar}><Download className="h-4 w-4 mr-1.5" />Descargar</Button>
              </div>
            </div>
          ) : (
            <iframe src={url} title={titulo} className="w-full h-full border-0" data-testid="iframe-pdf" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
