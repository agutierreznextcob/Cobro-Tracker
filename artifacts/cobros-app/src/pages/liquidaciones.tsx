import { useListLiquidaciones } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Landmark, ChevronRight, AlertCircle, RefreshCw, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatCLP(amount: number) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(amount);
}

function formatDate(dateStr: string) {
  const [year, month, day] = dateStr.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString("es-CL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function LiquidacionesPage() {
  const { data, isLoading, isError, error, refetch } = useListLiquidaciones();

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Landmark className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Liquidaciones Flow</h1>
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-muted/50 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    const msg = (error as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
      ?? (error as { message?: string })?.message
      ?? "Error al cargar las liquidaciones";

    const isSandbox = msg === "FLOW_SANDBOX_MODE";
    const isNoCreds = msg.toLowerCase().includes("credencial") || msg.toLowerCase().includes("configurad");

    if (isSandbox) {
      return (
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Landmark className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Liquidaciones Flow</h1>
          </div>
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
                <FlaskConical className="h-7 w-7 text-amber-600" />
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-amber-900">Ambiente de pruebas activo</p>
                <p className="text-sm text-amber-700 max-w-sm">
                  Las liquidaciones estarán disponibles cuando actives tu cuenta de Flow en modo producción.
                  Por ahora estás en ambiente de pruebas.
                </p>
              </div>
              <a
                href="https://www.flow.cl"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-amber-600 underline underline-offset-2"
              >
                Más información en flow.cl →
              </a>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Landmark className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Liquidaciones Flow</h1>
        </div>
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div>
              <p className="font-medium text-destructive">{msg}</p>
              {isNoCreds && (
                <p className="text-sm text-muted-foreground mt-1">
                  Configura tu API Key y Secret Key de Flow en{" "}
                  <Link href="/perfil" className="underline text-primary">tu perfil</Link>.
                </p>
              )}
            </div>
            {!isNoCreds && (
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Reintentar
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const liquidaciones = data?.data ?? [];

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Landmark className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Liquidaciones Flow</h1>
            <p className="text-sm text-muted-foreground">
              {data?.total ?? 0} liquidaciones en total
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => refetch()} title="Actualizar">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {liquidaciones.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Landmark className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">No hay liquidaciones registradas aún.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {liquidaciones.map((liq) => (
            <Link key={liq.id} href={`/liquidaciones/${liq.id}`}>
              <Card className="cursor-pointer hover:shadow-md transition-shadow hover:border-primary/30">
                <CardContent className="flex items-center justify-between py-4 px-5">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">
                        {formatDate(liq.depositDate)}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        #{liq.id}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>{liq.nOrders} cobro{liq.nOrders !== 1 ? "s" : ""} incluido{liq.nOrders !== 1 ? "s" : ""}</span>
                      <span>·</span>
                      <span>Comisión Flow: {formatCLP(liq.fee)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-lg font-bold text-green-700">{formatCLP(liq.netAmount)}</div>
                      <div className="text-xs text-muted-foreground">neto depositado</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
