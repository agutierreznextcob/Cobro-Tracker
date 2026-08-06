import { useEffect, useState } from "react";
import {
  useGetDatosBancarios,
  useSaveDatosBancarios,
  useDeleteDatosBancarios,
  getGetDatosBancariosQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isValidRut, formatRut } from "@/lib/rut";
import { Loader2, CheckCircle2, Pencil, Trash2 } from "lucide-react";

const BANCOS = [
  "Banco de Chile",
  "BCI",
  "Santander",
  "Scotiabank",
  "Itaú",
  "BancoEstado",
  "Banco Falabella",
  "Banco Ripley",
  "Banco Security",
  "Banco BICE",
  "Otro",
];

const TIPOS_CUENTA = ["Cuenta Corriente", "Cuenta Vista", "Cuenta de Ahorro", "CuentaRUT"];

export function DatosBancariosSection() {
  const { data, isLoading } = useGetDatosBancarios();
  const save = useSaveDatosBancarios();
  const del = useDeleteDatosBancarios();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [banco, setBanco] = useState("");
  const [tipoCuenta, setTipoCuenta] = useState("");
  const [numeroCuenta, setNumeroCuenta] = useState("");
  const [titularNombre, setTitularNombre] = useState("");
  const [titularRut, setTitularRut] = useState("");
  const [emailComprobantes, setEmailComprobantes] = useState("");

  useEffect(() => {
    if (data?.configurado) {
      setBanco(data.banco ?? "");
      setTipoCuenta(data.tipoCuenta ?? "");
      setNumeroCuenta(data.numeroCuenta ?? "");
      setTitularNombre(data.titularNombre ?? "");
      setTitularRut(data.titularRut ? formatRut(data.titularRut) : "");
      setEmailComprobantes(data.emailComprobantes ?? "");
    }
  }, [data]);

  const handleSave = async () => {
    if (!banco || !tipoCuenta || !numeroCuenta.trim() || !titularNombre.trim() || !titularRut.trim() || !emailComprobantes.trim()) {
      toast({ title: "Completa todos los campos", variant: "destructive" });
      return;
    }
    if (!isValidRut(titularRut)) {
      toast({ title: "El RUT del titular no es válido", variant: "destructive" });
      return;
    }
    try {
      await save.mutateAsync({
        data: {
          banco,
          tipoCuenta,
          numeroCuenta: numeroCuenta.trim(),
          titularNombre: titularNombre.trim(),
          titularRut: titularRut.trim(),
          emailComprobantes: emailComprobantes.trim(),
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetDatosBancariosQueryKey() });
      setEditing(false);
      toast({ title: "Datos bancarios guardados", description: "Se incluirán en tus cobros manuales por transferencia." });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "No se pudieron guardar los datos bancarios";
      toast({ title: msg, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("¿Eliminar tus datos bancarios? Ya no se incluirán en los mensajes de cobranza.")) return;
    try {
      await del.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: getGetDatosBancariosQueryKey() });
      setBanco(""); setTipoCuenta(""); setNumeroCuenta("");
      setTitularNombre(""); setTitularRut(""); setEmailComprobantes("");
      setEditing(false);
      toast({ title: "Datos bancarios eliminados" });
    } catch {
      toast({ title: "No se pudieron eliminar los datos bancarios", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Cargando...</span>
      </div>
    );
  }

  if (data?.configurado && !editing) {
    return (
      <div className="space-y-4" data-testid="datos-bancarios-resumen">
        <div className="flex items-start gap-3 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/30">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-sm space-y-0.5">
            <p className="font-medium">Cuenta configurada</p>
            <p className="text-muted-foreground">{data.banco} · {data.tipoCuenta}</p>
            <p className="text-muted-foreground font-mono">N° {data.numeroCuenta}</p>
            <p className="text-muted-foreground">{data.titularNombre} · RUT {data.titularRut ? formatRut(data.titularRut) : "—"}</p>
            <p className="text-muted-foreground">Comprobantes a: {data.emailComprobantes}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="button-editar-datos-bancarios">
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Editar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10 border-destructive/30"
            onClick={handleDelete}
            disabled={del.isPending}
          >
            {del.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
            Eliminar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="datos-bancarios-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Banco</Label>
          <Select value={banco} onValueChange={setBanco}>
            <SelectTrigger data-testid="select-banco"><SelectValue placeholder="Selecciona tu banco" /></SelectTrigger>
            <SelectContent>
              {BANCOS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Tipo de cuenta</Label>
          <Select value={tipoCuenta} onValueChange={setTipoCuenta}>
            <SelectTrigger data-testid="select-tipo-cuenta"><SelectValue placeholder="Selecciona el tipo" /></SelectTrigger>
            <SelectContent>
              {TIPOS_CUENTA.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="numeroCuenta">N° de cuenta</Label>
          <Input
            id="numeroCuenta"
            value={numeroCuenta}
            onChange={(e) => setNumeroCuenta(e.target.value.replace(/[^\d\s-]/g, ""))}
            placeholder="Ej: 00123456789"
            className="font-mono"
            data-testid="input-numero-cuenta"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="titularNombre">Nombre del titular</Label>
          <Input
            id="titularNombre"
            value={titularNombre}
            onChange={(e) => setTitularNombre(e.target.value)}
            placeholder="Nombre completo o razón social"
            data-testid="input-titular-nombre"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="titularRut">RUT del titular</Label>
          <Input
            id="titularRut"
            value={titularRut}
            onChange={(e) => setTitularRut(e.target.value)}
            onBlur={() => { if (titularRut && isValidRut(titularRut)) setTitularRut(formatRut(titularRut)); }}
            placeholder="12.345.678-9"
            data-testid="input-titular-rut"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="emailComprobantes">Email para recibir comprobantes</Label>
          <Input
            id="emailComprobantes"
            type="email"
            value={emailComprobantes}
            onChange={(e) => setEmailComprobantes(e.target.value)}
            placeholder="pagos@tuempresa.cl"
            data-testid="input-email-comprobantes"
          />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <Button onClick={handleSave} disabled={save.isPending} className="min-w-28" data-testid="button-guardar-datos-bancarios">
          {save.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Guardando...</> : "Guardar datos bancarios"}
        </Button>
        {editing && (
          <Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        El número de cuenta se guarda encriptado (AES-256). Estos datos se incluyen automáticamente
        en los emails y mensajes de WhatsApp de cobros manuales (sin link de pago).
      </p>
    </div>
  );
}
