import { useEffect, useRef } from "react";
import { useListNotificaciones, getListNotificacionesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const POLL_INTERVAL_MS = 20_000;

export function useNotificacionesPolling() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const lastIdRef = useRef<number | null>(null);
  const initializedRef = useRef(false);

  const { data } = useListNotificaciones(
    { soloNoLeidas: true },
    {
      query: {
        queryKey: getListNotificacionesQueryKey({ soloNoLeidas: true }),
        refetchInterval: POLL_INTERVAL_MS,
        refetchIntervalInBackground: false,
        staleTime: POLL_INTERVAL_MS - 1000,
      },
    }
  );

  useEffect(() => {
    if (!data || data.length === 0) return;

    const latestId = data[0].id;

    if (!initializedRef.current) {
      lastIdRef.current = latestId;
      initializedRef.current = true;
      return;
    }

    if (latestId !== lastIdRef.current && latestId > (lastIdRef.current ?? 0)) {
      const diff = data.filter((n) => n.id > (lastIdRef.current ?? 0)).length;
      lastIdRef.current = latestId;

      queryClient.invalidateQueries({ queryKey: getListNotificacionesQueryKey() });

      toast({
        title: diff > 1 ? `${diff} recordatorios nuevos` : data[0].titulo,
        description: diff > 1 ? "Revisa tus notificaciones de WhatsApp." : data[0].mensaje ?? undefined,
        duration: 6000,
      });
    }
  }, [data, toast, queryClient]);
}
