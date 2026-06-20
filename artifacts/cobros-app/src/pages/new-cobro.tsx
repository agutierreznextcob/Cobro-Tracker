import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateCobro, useListClientes, useListMiembros, getListMiembrosQueryKey, getListCobrosQueryKey, getGetCobrosSummaryQueryKey, getGetDashboardMetricsQueryKey, type CobroInput } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/format";
import { Loader2, ArrowLeft, Users } from "lucide-react";
import { Link } from "wouter";

const IVA_RATE = 0.19;

const formSchema = z.object({
  monto: z.coerce.number().int("El monto debe ser un número entero").min(1, "El monto debe ser mayor a $0"),
  incluyeIva: z.boolean().default(false),
  descripcion: z.string().min(1, "La descripción es obligatoria").max(255),
  referencia: z.string().optional(),
  clienteId: z.coerce.number().optional(),
  emailPagador: z.string().email("Email inválido").optional().or(z.literal("")),
  fechaVencimiento: z.string().optional().or(z.literal("")),
  responsableId: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewCobro() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createCobro = useCreateCobro();
  const { user } = useAuth();
  const isOrgAdmin = user?.orgRole === "admin_org";

  const { data: clientes } = useListClientes();
  const { data: miembros } = useListMiembros({
    query: { enabled: isOrgAdmin, queryKey: getListMiembrosQueryKey() },
  });
  const miembrosActivos = miembros?.filter((m) => m.activo) ?? [];

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      monto: 0,
      incluyeIva: false,
      descripcion: "",
      referencia: "",
      clienteId: undefined,
      emailPagador: "",
      fechaVencimiento: "",
      responsableId: undefined,
    },
  });

  const selectedClienteId = form.watch("clienteId");
  const selectedCliente = clientes?.find((c) => c.id === selectedClienteId);

  const montoWatch = form.watch("monto");
  const incluyeIvaWatch = form.watch("incluyeIva");
  const netoNum = Number(montoWatch) || 0;
  const ivaNum = incluyeIvaWatch ? Math.round(netoNum * IVA_RATE) : 0;
  const totalNum = incluyeIvaWatch ? netoNum + ivaNum : netoNum;

  // Auto-fill email when a client is selected
  useEffect(() => {
    if (selectedCliente?.email) {
      form.setValue("emailPagador", selectedCliente.email, { shouldValidate: true });
    }
  }, [selectedCliente?.id]);

  const onSubmit = (values: FormValues) => {
    const payload: CobroInput = {
      monto: values.monto,
      incluyeIva: values.incluyeIva,
      descripcion: values.descripcion,
      referencia: values.referencia || undefined,
      emailPagador: values.emailPagador || selectedCliente?.email || undefined,
      clienteId: values.clienteId || undefined,
      fechaVencimiento: values.fechaVencimiento || undefined,
      responsableId: isOrgAdmin ? values.responsableId || undefined : undefined,
    };

    createCobro.mutate({ data: payload }, {
      onSuccess: (data) => {
        toast({
          title: "Cobro creado",
          description: "El cobro fue creado exitosamente.",
        });
        queryClient.invalidateQueries({ queryKey: getListCobrosQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCobrosSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardMetricsQueryKey() });
        setLocation(`/cobros/${data.id}`);
      },
      onError: () => {
        toast({
          title: "Error",
          description: "No se pudo crear el cobro.",
          variant: "destructive",
        });
      }
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      <Link href="/" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-2 transition-colors">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Volver al Dashboard
      </Link>

      <Card className="shadow-sm border-border/50">
        <CardHeader>
          <CardTitle className="text-2xl">Nuevo cobro</CardTitle>
          <CardDescription>Crea un nuevo cargo para seguimiento y cobro.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="monto"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{incluyeIvaWatch ? "Monto neto (sin IVA)" : "Monto"}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                          <Input
                            type="number"
                            step="1"
                            min="1"
                            placeholder="0"
                            className="pl-7 font-mono"
                            {...field}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="referencia"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Referencia (opcional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Factura #, N° de orden..." className="font-mono text-sm" {...field} />
                      </FormControl>
                      <FormDescription>Identificador externo para conciliación.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="incluyeIva"
                render={({ field }) => (
                  <FormItem className="rounded-lg border border-border/60 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-sm">Incluir IVA (19%)</FormLabel>
                        <FormDescription>
                          Si lo activas, el monto ingresado es el neto y se agrega el IVA al total a cobrar.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </div>

                    {incluyeIvaWatch && (
                      <div className="rounded-md bg-muted/50 p-3 space-y-1.5 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Neto</span>
                          <span className="font-mono">{formatCurrency(netoNum)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">IVA (19%)</span>
                          <span className="font-mono">{formatCurrency(ivaNum)}</span>
                        </div>
                        <div className="flex items-center justify-between pt-1.5 border-t border-border/60">
                          <span className="font-medium text-primary">Total a cobrar</span>
                          <span className="font-mono font-bold text-primary">{formatCurrency(totalNum)}</span>
                        </div>
                      </div>
                    )}
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="descripcion"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="¿Por qué es este cobro?"
                        className="resize-none h-24"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="clienteId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5" />
                      Cliente (opcional)
                    </FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === "ninguno" ? undefined : Number(v))}
                      value={field.value ? String(field.value) : "ninguno"}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar cliente..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ninguno">Sin cliente</SelectItem>
                        {clientes?.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            <div className="flex flex-col items-start">
                              <span>{c.nombre}</span>
                              {c.rut && <span className="text-xs text-muted-foreground font-mono">{c.rut}</span>}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Asocia este cobro a un cliente existente.{" "}
                      <Link href="/clientes" className="text-primary hover:underline">
                        Gestionar clientes →
                      </Link>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isOrgAdmin && miembrosActivos.length > 0 && (
                <FormField
                  control={form.control}
                  name="responsableId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        Ejecutivo responsable
                      </FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(v === "yo" ? undefined : v)}
                        value={field.value ?? "yo"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Asignar a..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="yo">Yo (asignármelo)</SelectItem>
                          {miembrosActivos
                            .filter((m) => m.id !== user?.id)
                            .map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                <div className="flex flex-col items-start">
                                  <span>{m.nombre || m.email}</span>
                                  {m.nombre && m.email && (
                                    <span className="text-xs text-muted-foreground">{m.email}</span>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Asigna este cobro a un miembro de tu equipo para su seguimiento.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="emailPagador"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email del pagador (opcional)</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder={selectedCliente?.email ?? "pagador@ejemplo.com"}
                        className="text-sm"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {selectedCliente?.email
                        ? `Se usará el email del cliente (${selectedCliente.email}) al generar el link de pago si no ingresas otro.`
                        : "Se usará al generar el link de pago con Flow."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fechaVencimiento"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de vencimiento (opcional)</FormLabel>
                    <FormControl>
                      <Input type="date" className="text-sm" {...field} />
                    </FormControl>
                    <FormDescription>
                      Si la indicas, se aplicará automáticamente tu secuencia de recordatorios para
                      avisar al cliente antes y después del vencimiento.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end pt-4 border-t border-border/50">
                <Button type="submit" disabled={createCobro.isPending} className="min-w-32">
                  {createCobro.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creando...</>
                  ) : (
                    "Crear cobro"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
