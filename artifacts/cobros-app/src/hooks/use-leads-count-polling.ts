import {
  useContarLeadsNuevos,
  getContarLeadsNuevosQueryKey,
} from "@workspace/api-client-react";

const POLL_INTERVAL_MS = 20_000;

// Polls the count of new (estado="nuevo") leads for the sidebar badge.
// Only meaningful for platform admins; callers should gate by role.
export function useLeadsCountPolling(enabled: boolean) {
  const { data } = useContarLeadsNuevos({
    query: {
      queryKey: getContarLeadsNuevosQueryKey(),
      refetchInterval: POLL_INTERVAL_MS,
      refetchIntervalInBackground: false,
      staleTime: POLL_INTERVAL_MS - 1000,
      enabled,
    },
  });

  return data?.count ?? 0;
}
