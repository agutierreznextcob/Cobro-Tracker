import { useEffect, useRef } from "react";
import { useListWebhookEventos, getListWebhookEventosQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { getListCobrosQueryKey, getGetCobrosSummaryQueryKey } from "@workspace/api-client-react";

const POLL_INTERVAL_MS = 15_000;

export function useWebhookPolling() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const lastIdRef = useRef<number | null>(null);
  const initializedRef = useRef(false);

  const { data } = useListWebhookEventos(
    { limit: 1, offset: 0 },
    {
      query: {
        queryKey: getListWebhookEventosQueryKey({ limit: 1, offset: 0 }),
        refetchInterval: POLL_INTERVAL_MS,
        refetchIntervalInBackground: false,
        staleTime: POLL_INTERVAL_MS - 1000,
      },
    }
  );

  useEffect(() => {
    if (!data || data.items.length === 0) return;

    const latestId = data.items[0].id;
    const latestEvento = data.items[0].evento;
    const latestResultado = data.items[0].resultado;

    if (!initializedRef.current) {
      lastIdRef.current = latestId;
      initializedRef.current = true;
      return;
    }

    if (latestId !== lastIdRef.current && latestId > (lastIdRef.current ?? 0)) {
      const diff = latestId - (lastIdRef.current ?? 0);
      lastIdRef.current = latestId;

      queryClient.invalidateQueries({ queryKey: getListWebhookEventosQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListCobrosQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCobrosSummaryQueryKey() });

      const esExitoso = latestResultado === "exitoso";
      toast({
        title: esExitoso ? "Nuevo evento webhook" : "Evento webhook fallido",
        description: `${diff > 1 ? `${diff} eventos nuevos` : `Evento: ${latestEvento}`}`,
        variant: esExitoso ? "default" : "destructive",
        duration: 5000,
      });
    }
  }, [data, toast, queryClient]);
}
