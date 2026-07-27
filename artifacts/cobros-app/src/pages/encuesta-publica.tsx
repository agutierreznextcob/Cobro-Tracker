import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import {
  useGetEncuesta,
  getGetEncuestaQueryKey,
  useResponderEncuesta,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star, CheckCircle2, Building2 } from "lucide-react";
import { formatCurrency } from "@/lib/format";

export default function EncuestaPublicaPage() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useGetEncuesta(token, {
    query: { queryKey: getGetEncuestaQueryKey(token) },
  });
  const responder = useResponderEncuesta();

  const [calificacion, setCalificacion] = useState(0);
  const [hover, setHover] = useState(0);
  const [comentario, setComentario] = useState("");
  const [enviado, setEnviado] = useState(false);

  // One-click flow: the email buttons land here with ?calificacion=N. Record it
  // automatically on first render in a real browser (email prefetchers don't
  // execute JS, so they can't register phantom answers via the GET redirect).
  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (autoSubmitted.current || !data || data.yaRespondida) return;
    const param = Number(new URLSearchParams(window.location.search).get("calificacion"));
    if (![1, 2, 3, 4, 5].includes(param)) return;
    autoSubmitted.current = true;
    setCalificacion(param);
    responder
      .mutateAsync({ token, data: { calificacion: param, comentario: null } })
      .then(() => {
        setEnviado(true);
        void queryClient.invalidateQueries({ queryKey: getGetEncuestaQueryKey(token) });
      })
      .catch(() => {
        // Fall back to manual selection UI.
        autoSubmitted.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, token]);

  async function handleSubmit() {
    if (calificacion < 1) return;
    try {
      await responder.mutateAsync({
        token,
        data: { calificacion, comentario: comentario.trim() || null },
      });
      setEnviado(true);
      void queryClient.invalidateQueries({ queryKey: getGetEncuestaQueryKey(token) });
    } catch {
      // handled by disabled/error UI below
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="text-sm text-muted-foreground">Cargando...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Encuesta no encontrada</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            El enlace puede haber expirado o no ser válido.
          </p>
        </div>
      </div>
    );
  }

  const yaRespondida = data.yaRespondida || enviado;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-primary">
          <Building2 className="h-4 w-4" />
          {data.empresa}
        </div>

        {yaRespondida ? (
          <div className="py-6 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <h1 className="mt-3 text-lg font-semibold">¡Gracias por tu opinión!</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tu calificación nos ayuda a mejorar nuestro servicio.
            </p>
            {(data.calificacion ?? calificacion) > 0 && (
              <div className="mt-4 flex justify-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={`h-6 w-6 ${
                      n <= (data.calificacion ?? calificacion)
                        ? "fill-amber-400 text-amber-400"
                        : "text-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold">¿Cómo fue tu experiencia?</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sobre el pago de {data.descripcion} ({formatCurrency(data.monto)}).
            </p>

            <div className="my-6 flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCalificacion(n)}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  aria-label={`${n} estrellas`}
                  className="transition-transform hover:scale-110"
                >
                  <Star
                    className={`h-9 w-9 ${
                      n <= (hover || calificacion)
                        ? "fill-amber-400 text-amber-400"
                        : "text-muted-foreground/30"
                    }`}
                  />
                </button>
              ))}
            </div>

            <Textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Cuéntanos más (opcional)"
              rows={3}
              className="mb-4"
            />

            <Button
              className="w-full"
              disabled={calificacion < 1 || responder.isPending}
              onClick={handleSubmit}
            >
              {responder.isPending ? "Enviando..." : "Enviar opinión"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
