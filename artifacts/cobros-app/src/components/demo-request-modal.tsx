import { useState, type ReactNode } from "react";
import { useCrearLeadPublico } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CheckCircle2, Loader2 } from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function DemoRequestModal({
  trigger,
  contentClassName,
}: {
  trigger: ReactNode;
  /** Optional extra class for the portaled dialog (marketing-only styling). */
  contentClassName?: string;
}) {
  const { toast } = useToast();
  const crearLead = useCrearLeadPublico();

  const [open, setOpen] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [correo, setCorreo] = useState("");
  const [mensaje, setMensaje] = useState("");

  const resetForm = () => {
    setNombre("");
    setTelefono("");
    setCorreo("");
    setMensaje("");
    setEnviado(false);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // Defer reset so the closing animation doesn't flash an empty form.
      setTimeout(resetForm, 200);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = nombre.trim();
    const t = telefono.trim();
    const c = correo.trim();
    if (!n || !t || !c) {
      toast({
        title: "Campos requeridos",
        description: "Completa nombre, teléfono y correo.",
        variant: "destructive",
      });
      return;
    }
    if (!EMAIL_RE.test(c)) {
      toast({
        title: "Correo inválido",
        description: "Ingresa un correo electrónico válido.",
        variant: "destructive",
      });
      return;
    }
    crearLead.mutate(
      { data: { nombre: n, telefono: t, email: c, mensaje: mensaje.trim() || undefined } },
      {
        onSuccess: () => {
          setEnviado(true);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo enviar la solicitud.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={`sm:max-w-md${contentClassName ? ` ${contentClassName}` : ""}`}>
        {enviado ? (
          <div className="flex flex-col items-center text-center py-6 gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-xl">¡Gracias!</DialogTitle>
              <DialogDescription>Te contactaremos pronto.</DialogDescription>
            </div>
            <Button onClick={() => handleOpenChange(false)} className="mt-2 w-full">
              Cerrar
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Agenda una presentación</DialogTitle>
              <DialogDescription>
                Déjanos tus datos y te contactaremos para coordinar una demo de NextCob.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="demo-nombre">
                  Nombre <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="demo-nombre"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Tu nombre"
                  maxLength={200}
                  autoComplete="name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="demo-telefono">
                  Teléfono <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="demo-telefono"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="+56 9 1234 5678"
                  maxLength={50}
                  autoComplete="tel"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="demo-correo">
                  Correo <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="demo-correo"
                  type="email"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  placeholder="tu@correo.com"
                  maxLength={200}
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="demo-mensaje">Mensaje (opcional)</Label>
                <Textarea
                  id="demo-mensaje"
                  value={mensaje}
                  onChange={(e) => setMensaje(e.target.value)}
                  placeholder="Cuéntanos sobre tu negocio o lo que necesitas."
                  maxLength={2000}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={crearLead.isPending} className="w-full">
                {crearLead.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  "Enviar solicitud"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
