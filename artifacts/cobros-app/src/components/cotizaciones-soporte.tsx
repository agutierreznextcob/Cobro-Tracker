import { useState } from "react";
import { useListCotizacionesEnvios, getListCotizacionesEnviosQueryKey, useConciliarCotizacion, type CotizacionEnvioSoporte } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function Envio({ row, refresh, notify }: { row: CotizacionEnvioSoporte; refresh: () => void; notify: (message: string) => void }) {
  const [providerId, setProviderId] = useState("");
  const [reason, setReason] = useState("");
  const [providerCase, setProviderCase] = useState("");
  const [providerStatement, setProviderStatement] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const mutation = useConciliarCotizacion();
  const run = (action: "consultar" | "confirmar" | "autorizar") => {
    setMessage("");
    mutation.mutate({ id: row.id, data: {
      action, key: row.key, reason, ...(action === "autorizar"
        ? { providerCase, providerStatement, noAcceptanceConfirmed: confirmed }
        : { providerId }),
    } }, {
      onSuccess: () => {
        notify(action === "consultar" ? "Resend confirma el mensaje y el PDF. La consulta quedó auditada; falta confirmar el estado."
          : action === "confirmar" ? "Envío confirmado sin reenviar." : "Nuevo intento autorizado. El responsable puede reintentar durante 23 horas con el mensaje y PDF originales.");
        setConfirmed(false);
        refresh();
      },
      onError: (error) => setMessage((error as { data?: { error?: string } }).data?.error ?? "No se pudo conciliar. No se ha autorizado un envío."),
    });
  };
  return <details className="rounded border p-3">
    <summary className="cursor-pointer font-medium">{row.numero} · {row.email} · {row.confirmed ? "Confirmado" : "Pendiente"}</summary>
    <div className="space-y-3 pt-3 text-sm">
      <p className="break-all">Clave: {row.key}<br />PDF SHA-256: {row.sha256}<br />Inicio del intento: {row.windowStart}</p>
      <p>La conciliación exige 24 horas desde el inicio y una hora sin intentos activos. Confirmar significa aceptado por Resend, no entregado al destinatario.</p>
      <fieldset disabled={row.confirmed} className="space-y-3 disabled:opacity-50">
      <label className="block">Motivo (mínimo 10 caracteres)<Input value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} /></label>
      <label className="block">ID del correo encontrado en Resend<Input value={providerId} onChange={e => setProviderId(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={mutation.isPending || !providerId || reason.trim().length < 10} onClick={() => run("consultar")}>Verificar en Resend</Button>
        <Button disabled={mutation.isPending || !providerId || reason.trim().length < 10} onClick={() => run("confirmar")}>Verificar y confirmar envío</Button>
      </div>
      <details className="border-t pt-3">
        <summary className="cursor-pointer">Autorizar otro intento con evidencia de no aceptación</summary>
        <div className="space-y-3 pt-3">
          <p>No basta un 404, una lista vacía, un error ni un rebote. Solicita a soporte de Resend confirmación escrita de que NINGÚN intento con esta clave fue aceptado. Si no pueden comprobarlo, conserva el bloqueo.</p>
          <label className="block">Referencia del caso de Resend<Input value={providerCase} onChange={e => setProviderCase(e.target.value)} maxLength={500} /></label>
          <label className="block">Respuesta escrita del proveedor (debe incluir la clave)<Textarea value={providerStatement} onChange={e => setProviderStatement(e.target.value)} maxLength={5000} /></label>
          <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Verifiqué la respuesta auténtica de Resend y confirma que ningún intento de esta clave fue aceptado. Quedará registrado bajo mi usuario.</label>
          <Button variant="outline" disabled={mutation.isPending || !confirmed || reason.trim().length < 10 || providerCase.length < 5 || providerStatement.length < 50 || !providerStatement.includes(row.key)} onClick={() => run("autorizar")}>Registrar evidencia y autorizar reintento</Button>
        </div>
      </details>
      </fieldset>
      {message && <p role="status">{message}</p>}
      <details><summary className="cursor-pointer">Auditoría ({row.audit.length})</summary>
        {row.audit.map((entry, i) => <div className="border-t py-2 break-words" key={i}>
          <p>{entry.at} · {entry.actor} · {entry.action}</p><p>{entry.reason}</p><pre className="whitespace-pre-wrap text-xs">{entry.evidence}</pre>
        </div>)}
      </details>
    </div>
  </details>;
}

export function CotizacionesSoporte() {
  const [notice, setNotice] = useState("");
  const query = useListCotizacionesEnvios({ query: { queryKey: getListCotizacionesEnviosQueryKey(), staleTime: 0, refetchInterval: 60_000 } });
  return <section className="rounded-lg border bg-card p-4 space-y-3">
    <h2 className="text-lg font-semibold">Conciliación de envíos de cotizaciones</h2>
    <p className="text-sm text-muted-foreground">Soporte de plataforma. No se regeneran adjuntos ni se envían correos desde este panel.</p>
    <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>Actualizar envíos</Button>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {query.isLoading ? <p>Cargando…</p> : query.isError ? <p role="alert">No se pudo cargar la conciliación.</p>
      : query.data?.length === 0 ? <p>No hay envíos pendientes de confirmar.</p>
      : query.data?.map(row => <Envio key={`${row.id}-${row.key}`} row={row} notify={setNotice} refresh={() => { void query.refetch(); }} />)}
  </section>;
}
