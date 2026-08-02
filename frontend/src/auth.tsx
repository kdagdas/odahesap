/**
 * AuthContext — e-mail + password auth against our own backend.
 * The session token lives in expo-secure-store on native, localStorage on web.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { apiPost, apiGet, getToken, setToken } from "./api";

export type AppUser = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  avatar_id?: number;
};

type AuthResponse = { session_token: string; user: AppUser };

type Ctx = {
  user: AppUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthCtx = createContext<Ctx>({} as any);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await apiGet<{ user: AppUser }>("/auth/me");
      setUser(res.user);
    } catch {
      setUser(null);
    }
  }, []);

  // Bootstrap: only hit the network when a token is actually stored.
  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (token) await refresh();
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiPost<AuthResponse>("/auth/login", {
      email: email.trim().toLowerCase(),
      password,
    });
    await setToken(res.session_token);
    setUser(res.user);
  }, []);

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      const res = await apiPost<AuthResponse>("/auth/register", {
        email: email.trim().toLowerCase(),
        password,
        name: name.trim(),
      });
      await setToken(res.session_token);
      setUser(res.user);
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await apiPost("/auth/logout", {});
    } catch {}
    await setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider
      value={{ user, loading, login, register, logout, refresh }}
    >
      {children}
    </AuthCtx.Provider>
  );
}
