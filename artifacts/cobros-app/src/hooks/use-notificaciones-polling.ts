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
    if (!data) return;

    if (!initializedRef.current) {
      lastIdRef.current = data.length > 0 ? data[0].id : null;
      initializedRef.current = true;
      return;
    }

    if (data.length === 0) return;

    const latestId = data[0].id;
    const previousId = lastIdRef.current ?? 0;

    if (latestId !== previousId && latestId > previousId) {
      const diff = data.filter((n) => n.id > previousId).length;
      lastIdRef.current = latestId;

      queryClient.invalidateQueries({ queryKey: getListNotificacionesQueryKey() });

      toast({
        title: diff > 1 ? `${diff} notificaciones nuevas` : data[0].titulo,
        description: diff > 1 ? "Revisa tu centro de actividades." : data[0].mensaje ?? undefined,
        duration: 6000,
      });
    }
  }, [data, toast, queryClient]);
}
