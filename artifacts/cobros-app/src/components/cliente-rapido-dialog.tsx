/**
 * ClienteRapidoDialog — botón "+" junto al selector de cliente
 * que abre un modal para crear un cliente al vuelo sin salir del
 * formulario de cobro o cotización.
 *
 * Al guardar, llama onCreated(cliente) para que el formulario
 * padre pueda seleccionar el nuevo cliente automáticamente.
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useCreateCliente,
  getListClientesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Plus, Loader2 } from "lucide-react";

// ── RUT helpers ──────────────────────────────────────────────────────────────

function validarRut(rut: string): boolean {
  const cleaned = rut.replace(/\./g, "").replace(/-/g, "").toLowerCase();
  if (!/^\d{7,8}[0-9k]$/.test(cleaned)) return false;
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  let sum = 0, mult = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const exp = 11 - (sum % 11);
  const dvExp = exp === 11 ? "0" : exp === 10 ? "k" : String(exp);
  return dv === dvExp;
}

function formatRutInput(value: string): string {
  const cleaned = value.replace(/[^0-9kK]/g, "").toUpperCase();
  if (cleaned.length < 2) return cleaned;
  const dv = cleaned.slice(-1);
  const body = cleaned.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${body}-${dv}`;
}

// ── Schema ───────────────────────────────────────────────────────────────────

const schema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio").max(200),
  rut: z
    .string()
    .min(1, "El RUT es obligatorio")
    .refine(validarRut, "RUT inválido"),
  email: z.string().email("Email inválido").or(z.literal("")).optional(),
  telefono: z.string().max(30).optional(),
  direccion: z.string().max(300).optional(),
  giro: z.string().max(300).optional(),
});
type FormValues = z.infer<typeof schema>;

// ── Types ────────────────────────────────────────────────────────────────────

export interface ClienteCreado {
  id: number;
  nombre: string;
  rut?: string | null;
  email?: string | null;
  telefono?: string | null;
}

interface Props {
  /** Callback con el cliente recién creado para que el padre lo seleccione */
  onCreated: (cliente: ClienteCreado) => void;
  /** Texto alternativo del tooltip */
  tooltip?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ClienteRapidoDialog({ onCreated, tooltip = "Crear nuevo cliente" }: Props) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const createCliente = useCreateCliente();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { nombre: "", rut: "", email: "", telefono: "", direccion: "", giro: "" },
  });

  const onSubmit = (values: FormValues) => {
    createCliente.mutate(
      {
        data: {
          nombre: values.nombre,
          rut: values.rut,
          email: values.email || undefined,
          telefono: values.telefono || undefined,
          direccion: values.direccion?.trim() || undefined,
          giro: values.giro?.trim() || undefined,
        },
      },
      {
        onSuccess: (cliente) => {
          toast({ title: "Cliente creado", description: `${cliente.nombre} fue agregado a tus clientes.` });
          // Invalidar lista para que aparezca en el selector
          qc.invalidateQueries({ queryKey: getListClientesQueryKey() });
          form.reset();
          setOpen(false);
          onCreated(cliente as ClienteCreado);
        },
        onError: () => {
          toast({ title: "Error al crear cliente", description: "Verifica los datos e intenta nuevamente.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) form.reset(); }}>
      <DialogTrigger asChild>
        <button
          type="button"
          title={tooltip}
          className="inline-flex items-center justify-center h-6 w-6 rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            Nuevo cliente
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-1">

            {/* Nombre */}
            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Razón social / Nombre *</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Empresa Ltda. o Juan Pérez" autoFocus {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* RUT */}
            <FormField
              control={form.control}
              name="rut"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>RUT *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="12.345.678-9"
                      className="font-mono"
                      {...field}
                      onChange={(e) => field.onChange(formatRutInput(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Email + Teléfono */}
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
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
                    <FormLabel>Teléfono</FormLabel>
                    <FormControl>
                      <Input placeholder="+56 9 1234 5678" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Dirección */}
            <FormField
              control={form.control}
              name="direccion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dirección <span className="text-muted-foreground font-normal">(opcional)</span></FormLabel>
                  <FormControl>
                    <Input placeholder="Av. Ejemplo 1234, Of. 1, Santiago" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Giro */}
            <FormField
              control={form.control}
              name="giro"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Giro comercial <span className="text-muted-foreground font-normal">(opcional)</span></FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Construcción de obras civiles" maxLength={300} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Botones */}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createCliente.isPending}>
                {createCliente.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Guardando...</>
                  : "Guardar cliente"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
