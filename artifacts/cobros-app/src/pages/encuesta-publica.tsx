import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import {
  useGetEncuesta,
  getGetEncuestaQueryKey,
  useResponderEncuesta,
  useAgregarComentarioEncuesta,
  useRegistrarClickGoogle,
  type EncuestaPublica,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star, CheckCircle2, Building2, Loader2, ExternalLink, Lock } from "lucide-react";
import { formatCurrency } from "@/lib/format";

const MAX_COMENTARIO = 2000;

function statusOf(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status?: unknown }).status;
    return typeof s === "number" ? s : undefined;
  }
  return undefined;
}

export default function EncuestaPublicaPage() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const queryKey = getGetEncuestaQueryKey(token);
  const { data, isLoading, error, refetch } = useGetEncuesta(token, {
    query: { queryKey },
  });
  const responder = useResponderEncuesta();
  const agregarComentario = useAgregarComentarioEncuesta();
  const registrarClick = useRegistrarClickGoogle();

  const [calificacion, setCalificacion] = useState(0);
  const [hover, setHover] = useState(0);
  const [comentario, setComentario] = useState("");
  const [submitError, setSubmitError] = useState(false);
  const [autoPending, setAutoPending] = useState(false);

  const [comentarioPost, setComentarioPost] = useState("");
  const [comentarioError, setComentarioError] = useState(false);
  const [comentarioEnviado, setComentarioEnviado] = useState(false);

  const [googleMsg, setGoogleMsg] = useState<null | { tipo: "error" | "bloqueado" | "no-disponible" | "abierto"; texto: string }>(null);
  const [googlePending, setGooglePending] = useState(false);

  const setCache = (d: EncuestaPublica) => queryClient.setQueryData(queryKey, d);

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
    setAutoPending(true);
    responder
      .mutateAsync({ token, data: { calificacion: param, comentario: null } })
      .then((res) => {
        setCache(res);
      })
      .catch(() => {
        // Fall back to manual selection UI.
        autoSubmitted.current = false;
        void refetch();
      })
      .finally(() => setAutoPending(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, token]);

  async function handleSubmit() {
    if (calificacion < 1) return;
    setSubmitError(false);
    try {
      const res = await responder.mutateAsync({
        token,
        data: { calificacion, comentario: comentario.trim().slice(0, MAX_COMENTARIO) || null },
      });
      setCache(res);
    } catch {
      setSubmitError(true);
    }
  }

  async function handleComentario() {
    const texto = comentarioPost.trim().slice(0, MAX_COMENTARIO);
    if (!texto) return;
    setComentarioError(false);
    try {
      const res = await agregarComentario.mutateAsync({ token, data: { comentario: texto } });
      setCache(res);
      setComentarioEnviado(true);
    } catch (err) {
      if (statusOf(err) === 409) {
        // Already has a comment: sync with server.
        void refetch();
        setComentarioEnviado(true);
        return;
      }
      setComentarioError(true);
    }
  }

  async function handleGoogle() {
    setGoogleMsg(null);
    // Open synchronously within the user gesture to avoid popup blockers.
    const win = window.open("", "_blank");
    if (!win) {
      setGoogleMsg({ tipo: "bloqueado", texto: "Tu navegador no permitió abrir una nueva pestaña. Permite ventanas emergentes para este sitio y vuelve a presionar el botón." });
      return;
    }
    if (win) {
      try {
        win.opener = null;
      } catch {
        // ignore
      }
    }
    setGooglePending(true);
    try {
      const { url } = await registrarClick.mutateAsync({ token });
      if (data) setCache({ ...data, googleRedirigido: true });
      if (win && !win.closed) {
        win.location.href = url;
        setGoogleMsg({ tipo: "abierto", texto: "Abrimos Google en una nueva pestaña. Gracias por tu tiempo." });
      } else {
        setGoogleMsg({
          tipo: "bloqueado",
          texto: "Tu navegador no permitió abrir una nueva pestaña. Permite ventanas emergentes para este sitio y vuelve a presionar el botón.",
        });
      }
    } catch (err) {
      if (win && !win.closed) win.close();
      if (statusOf(err) === 409) {
        void refetch();
        setGoogleMsg({ tipo: "no-disponible", texto: "La invitación a reseñar en Google ya no está disponible." });
      } else {
        setGoogleMsg({ tipo: "error", texto: "No pudimos abrir Google. Revisa tu conexión e inténtalo de nuevo." });
      }
    } finally {
      setGooglePending(false);
    }
  }

  if (isLoading || autoPending) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {autoPending ? "Registrando tu calificación..." : "Cargando..."}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 p-4">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Encuesta no encontrada</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            El enlace puede haber expirado o no ser válido.
          </p>
        </div>
      </div>
    );
  }

  const calif = data.calificacion ?? calificacion;
  const puedeComentar = !data.comentario && !comentarioEnviado;
  const googleUrl = data.googleReviewUrl;

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-primary">
          <Building2 className="h-4 w-4" />
          {data.empresa}
        </div>

        {data.yaRespondida ? (
          <div className="py-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <h1 className="mt-3 text-lg font-semibold">¡Gracias por tu opinión!</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tu calificación nos ayuda a mejorar nuestro servicio.
            </p>
            {calif > 0 && (
              <div className="mt-4 flex justify-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={`h-6 w-6 ${n <= calif ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
                  />
                ))}
              </div>
            )}

            {puedeComentar ? (
              <div className="mt-6 space-y-2 text-left">
                <label htmlFor="comentario-post" className="text-sm font-medium">
                  ¿Quieres agregar un comentario? (opcional)
                </label>
                <Textarea
                  id="comentario-post"
                  value={comentarioPost}
                  maxLength={MAX_COMENTARIO}
                  onChange={(e) => setComentarioPost(e.target.value)}
                  placeholder="Cuéntanos más"
                  rows={3}
                  data-testid="input-comentario-post"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Lock className="h-3 w-3" /> Privado: solo lo verá el equipo del negocio.
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {comentarioPost.length}/{MAX_COMENTARIO}
                  </span>
                </div>
                {comentarioError && (
                  <p className="text-xs text-red-600">No pudimos guardar tu comentario. Inténtalo de nuevo.</p>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!comentarioPost.trim() || agregarComentario.isPending}
                  onClick={handleComentario}
                  data-testid="button-enviar-comentario"
                >
                  {agregarComentario.isPending ? "Enviando..." : comentarioError ? "Reintentar" : "Enviar comentario"}
                </Button>
              </div>
            ) : comentarioEnviado ? (
              <p className="mt-4 text-sm text-muted-foreground">Recibimos tu comentario. Gracias.</p>
            ) : null}

            {googleUrl && (
              <div className="mt-6 rounded-xl border bg-secondary/40 p-4 text-left" data-testid="card-google-review">
                <p className="text-sm font-semibold">¡Gracias! ¿Nos ayudas con una reseña en Google?</p>
                <Button
                  className="mt-3 w-full gap-2"
                  onClick={handleGoogle}
                  disabled={googlePending}
                  data-testid="button-google-review"
                >
                  {googlePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  {googleMsg?.tipo === "error" || googleMsg?.tipo === "bloqueado" ? "Intentar de nuevo" : "Dejar una reseña en Google"}
                </Button>
              </div>
            )}
            {googleMsg && (
              <p
                role="status"
                className={`mt-3 text-xs ${googleMsg.tipo === "error" ? "text-red-600" : "text-muted-foreground"}`}
              >
                {googleMsg.texto}
              </p>
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
              maxLength={MAX_COMENTARIO}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Cuéntanos más (opcional, privado)"
              rows={3}
              className="mb-4"
            />

            {submitError && (
              <p className="mb-3 text-xs text-red-600">No pudimos enviar tu opinión. Inténtalo de nuevo.</p>
            )}

            <Button
              className="w-full"
              disabled={calificacion < 1 || responder.isPending}
              onClick={handleSubmit}
            >
              {responder.isPending ? "Enviando..." : submitError ? "Reintentar" : "Enviar opinión"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
