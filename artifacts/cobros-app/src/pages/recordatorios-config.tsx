import { useEffect, useState } from "react";
import {
  useGetRecordatoriosDefault,
  getGetRecordatoriosDefaultQueryKey,
  useUpdateRecordatoriosDefault,
  type RecordatorioDefaultItem,
  type RecordatorioDefaultItemCanal,
  type RecordatorioDefaultItemMomento,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarClock, Plus, Trash2, Save, Loader2, Mail, MessageCircle, Send } from "lucide-react";

type Item = {
  canal: RecordatorioDefaultItemCanal;
  momento: RecordatorioDefaultItemMomento;
  diasOffset: number;
};

export default function RecordatoriosConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: defaults, isLoading } = useGetRecordatoriosDefault({
    query: { queryKey: getGetRecordatoriosDefaultQueryKey() },
  });
  const updateDefaults = useUpdateRecordatoriosDefault();

  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    if (defaults) {
      setItems(
        defaults.map((d) => ({
          canal: d.canal,
          momento: d.momento,
          diasOffset: d.diasOffset,
        }))
      );
    }
  }, [defaults]);

  const addItem = () => {
    setItems((prev) => [...prev, { canal: "email", momento: "despues", diasOffset: 3 }]);
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateItem = (idx: number, patch: Partial<Item>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const handleSave = () => {
    for (const it of items) {
      if (it.momento !== "dia" && (!Number.isInteger(it.diasOffset) || it.diasOffset < 1)) {
        toast({
          title: "Días inválidos",
          description: "Cada regla (excepto 'el día del vencimiento') necesita un número de días mayor a 0.",
          variant: "destructive",
        });
        return;
      }
    }

    const payload: RecordatorioDefaultItem[] = items.map((it) => ({
      canal: it.canal,
      momento: it.momento,
      diasOffset: it.momento === "dia" ? 0 : it.diasOffset,
      activo: true,
    }));

    updateDefaults.mutate(
      { data: { items: payload } },
      {
        onSuccess: () => {
          toast({
            title: "Secuencia guardada",
            description: "Se aplicará a los nuevos cobros con fecha de vencimiento.",
          });
          queryClient.invalidateQueries({ queryKey: getGetRecordatoriosDefaultQueryKey() });
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "No se pudo guardar la secuencia.";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <CalendarClock className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Secuencia de recordatorios</h1>
          <p className="text-sm text-muted-foreground">
            Define la secuencia que se aplicará automáticamente a cada nuevo cobro con fecha de vencimiento.
          </p>
        </div>
      </div>

      <Card className="shadow-sm border-border/50">
        <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
          <CardTitle className="text-lg">Reglas por defecto</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted/40 rounded animate-pulse" />)}
            </div>
          ) : (
            <>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-3">
                  No hay reglas. Agrega al menos una para activar los recordatorios automáticos.
                </p>
              ) : (
                <div className="space-y-3">
                  {items.map((it, idx) => (
                    <div
                      key={idx}
                      className="flex flex-col sm:flex-row sm:items-end gap-3 rounded-md border border-border/50 bg-background p-3"
                    >
                      <div className="flex items-center sm:self-center pt-5 sm:pt-0 text-muted-foreground">
                        {it.canal === "whatsapp" ? (
                          <MessageCircle className="h-4 w-4 text-emerald-600" />
                        ) : it.canal === "ambos" ? (
                          <Send className="h-4 w-4 text-primary" />
                        ) : (
                          <Mail className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      <div className="space-y-1.5 flex-1">
                        <Label className="text-xs">Canal</Label>
                        <Select
                          value={it.canal}
                          onValueChange={(v) => updateItem(idx, { canal: v as RecordatorioDefaultItemCanal })}
                        >
                          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="email">Email</SelectItem>
                            <SelectItem value="whatsapp">WhatsApp</SelectItem>
                            <SelectItem value="ambos">Ambos</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5 flex-1">
                        <Label className="text-xs">Momento</Label>
                        <Select
                          value={it.momento}
                          onValueChange={(v) => updateItem(idx, { momento: v as RecordatorioDefaultItemMomento })}
                        >
                          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="antes">Antes del vencimiento</SelectItem>
                            <SelectItem value="dia">El día del vencimiento</SelectItem>
                            <SelectItem value="despues">Después del vencimiento</SelectItem>
                            <SelectItem value="recurrente">Recurrente (cada X días)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {it.momento !== "dia" && (
                        <div className="space-y-1.5 w-full sm:w-24">
                          <Label className="text-xs">Días</Label>
                          <Input
                            type="number"
                            min={1}
                            value={it.diasOffset}
                            onChange={(e) => updateItem(idx, { diasOffset: parseInt(e.target.value || "0", 10) })}
                            className="h-9 text-sm"
                          />
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive shrink-0 self-end"
                        onClick={() => removeItem(idx)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-border/50">
                <Button variant="outline" className="gap-1.5" onClick={addItem}>
                  <Plus className="h-4 w-4" />
                  Agregar regla
                </Button>
                <Button className="gap-1.5 sm:ml-auto" onClick={handleSave} disabled={updateDefaults.isPending}>
                  {updateDefaults.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Guardar secuencia
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
