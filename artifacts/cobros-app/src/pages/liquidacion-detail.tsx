import { useGetLiquidacion } from "@workspace/api-client-react";
import { Link } from "wouter";
import { ArrowLeft, Landmark, AlertCircle, RefreshCw, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Props {
  params: { id: string };
}

function formatCLP(amount: number) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(amount);
}

function formatDate(dateStr: string) {
  if (!dateStr) return "-";
  const [year, month, day] = dateStr.split("-");
  if (!year || !month || !day) return dateStr;
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString("es-CL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: number }) {
  if (status === 2) return (
    <Badge className="bg-green-100 text-green-800 border-green-200">
      <CheckCircle2 className="h-3 w-3 mr-1" />Pagado
    </Badge>
  );
  if (status === 3) return (
    <Badge variant="destructive">
      <XCircle className="h-3 w-3 mr-1" />Rechazado
    </Badge>
  );
  if (status === 4) return (
    <Badge variant="secondary">
      <XCircle className="h-3 w-3 mr-1" />Cancelado
    </Badge>
  );
  return (
    <Badge variant="outline">
      <Clock className="h-3 w-3 mr-1" />Pendiente
    </Badge>
  );
}

export default function LiquidacionDetailPage({ params }: Props) {
  const id = Number(params.id);
  const { data, isLoading, isError, error, refetch } = useGetLiquidacion(id);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="h-8 w-48 bg-muted/50 rounded animate-pulse mb-6" />
        <div className="h-32 bg-muted/50 rounded-lg animate-pulse mb-6" />
        <div className="h-64 bg-muted/50 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (isError) {
    const msg = (error as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
      ?? (error as { message?: string })?.message
      ?? "Error al cargar el detalle";

    return (
      <div className="max-w-4xl mx-auto">
        <Link href="/liquidaciones">
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />Volver
          </Button>
        </Link>
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="font-medium text-destructive">{msg}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />Reintentar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="max-w-4xl mx-auto">
      <Link href="/liquidaciones">
        <Button variant="ghost" size="sm" className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />Volver a liquidaciones
        </Button>
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <Landmark className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Liquidación #{data.id}</h1>
          <p className="text-sm text-muted-foreground">Depósito: {formatDate(data.depositDate)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Monto bruto</div>
            <div className="text-xl font-bold">{formatCLP(data.amount)}</div>
          </CardContent>
        </Card>
        <Card className="border-green-200">
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Neto depositado</div>
            <div className="text-xl font-bold text-green-700">{formatCLP(data.netAmount)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Comisión Flow</div>
            <div className="text-xl font-bold text-orange-600">{formatCLP(data.fee)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Cobros incluidos</div>
            <div className="text-xl font-bold">{data.nOrders}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cobros incluidos en esta liquidación</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.data.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No hay cobros en el detalle
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referencia</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Pagador</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Fecha pago</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Comisión</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((pago) => (
                  <TableRow key={pago.flowOrder}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {pago.commerceOrder}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">{pago.subject}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[140px] truncate">
                      {pago.payer}
                    </TableCell>
                    <TableCell className="text-sm">
                      {pago.paymentData?.media ?? "-"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {pago.paymentData?.date ? formatDate(pago.paymentData.date) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCLP(pago.amount)}
                    </TableCell>
                    <TableCell className="text-right text-orange-600 text-sm">
                      {pago.paymentData?.fee != null ? formatCLP(pago.paymentData.fee) : "-"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={pago.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
