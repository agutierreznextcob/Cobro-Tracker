import {
  useGetEncuestasResumen,
  getGetEncuestasResumenQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Star, Loader2, MessageSquare } from "lucide-react";
import { formatDate } from "@/lib/format";

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-4 w-4 ${n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </span>
  );
}

export default function EncuestasPage() {
  const { data, isLoading } = useGetEncuestasResumen({
    query: { queryKey: getGetEncuestasResumenQueryKey() },
  });

  const maxDist = Math.max(1, ...(data?.distribucion.map((d) => d.cantidad) ?? [1]));

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <MessageSquare className="h-6 w-6 text-primary" />
          Satisfacción del cliente
        </h1>
        <p className="text-sm text-muted-foreground">
          Encuestas enviadas automáticamente al confirmarse cada pago.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <div className="text-2xl font-bold tabular-nums">
                  {data.promedio.toFixed(1)}
                  <span className="text-sm font-normal text-muted-foreground"> / 5</span>
                </div>
                <div className="mt-1">
                  <Stars value={Math.round(data.promedio)} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Promedio</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="text-2xl font-bold tabular-nums">{data.respondidas}</div>
                <div className="mt-1 text-xs text-muted-foreground">Respuestas recibidas</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="text-2xl font-bold tabular-nums">{data.total}</div>
                <div className="mt-1 text-xs text-muted-foreground">Encuestas enviadas</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Distribución</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[...data.distribucion].reverse().map((d) => (
                <div key={d.calificacion} className="flex items-center gap-3">
                  <span className="flex w-16 items-center gap-1 text-sm">
                    {d.calificacion} <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  </span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-amber-400"
                      style={{ width: `${(d.cantidad / maxDist) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-sm tabular-nums text-muted-foreground">
                    {d.cantidad}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Comentarios recientes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.recientes.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Aún no hay respuestas.</p>
              ) : (
                data.recientes.map((r, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{r.clienteNombre ?? "Cliente"}</span>
                      <Stars value={r.calificacion} />
                    </div>
                    {r.comentario && <p className="mt-1 text-sm text-muted-foreground">{r.comentario}</p>}
                    {r.respondidoEn && (
                      <p className="mt-1 text-xs text-muted-foreground">{formatDate(r.respondidoEn)}</p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
