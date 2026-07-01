import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser } from "@workspace/api-client-react";

export type { AuthUser };

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

// Shared auth provider. The current user is fetched from /api/auth/user exactly
// once when the app mounts and then kept in memory, so navigating between pages
// never re-hits the network/DB or flashes a loader. Call refresh() (or do a full
// page reload) to re-read the user after mutating identity/role state.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/user", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ user: AuthUser | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setUser(data.user ?? null);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const login = useCallback(() => {
    const base = import.meta.env.BASE_URL.replace(/\/+$/, "") || "";
    window.location.href = `${base}/login`;
  }, []);

  const logout = useCallback(() => {
    const base = import.meta.env.BASE_URL.replace(/\/+$/, "") || "";
    fetch("/api/auth/logout", { method: "POST", credentials: "include" })
      .catch(() => {
        // Ignore network errors; we still navigate away to clear local state.
      })
      .finally(() => {
        window.location.href = `${base}/`;
      });
  }, []);

  const refresh = useCallback(() => {
    setIsLoading(true);
    setNonce((n) => n + 1);
  }, []);

  const value: AuthState = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    refresh,
  };

  return createElement(AuthContext.Provider, { value }, children);
}

// Reads the shared auth state. Must be used within an <AuthProvider>. All
// consumers share a single fetch, so this is cheap to call from any component.
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}
