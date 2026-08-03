/**
 * API client for OdaHesap backend. Uses EXPO_PUBLIC_BACKEND_URL + /api prefix.
 * Auth token is stored in expo-secure-store on native, localStorage on web.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;
const TOKEN_KEY = "odahesap_session_token";

let inMemoryToken: string | null = null;

export async function getToken(): Promise<string | null> {
  if (inMemoryToken) return inMemoryToken;
  if (Platform.OS === "web") {
    try {
      const t = window.localStorage.getItem(TOKEN_KEY);
      inMemoryToken = t;
      return t;
    } catch {
      return null;
    }
  }
  const t = await SecureStore.getItemAsync(TOKEN_KEY);
  inMemoryToken = t;
  return t;
}

export async function setToken(token: string | null) {
  inMemoryToken = token;
  if (Platform.OS === "web") {
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch {}
    return;
  }
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/**
 * Cold-start signalling.
 *
 * The API runs on a free tier that sleeps after 15 minutes idle; the first
 * request then takes ~50s while the container boots, and can fail outright
 * with a 502 mid-boot. Without this the user just stares at a spinner and
 * assumes the app is broken, so: retry the boot failures, and let the UI say
 * what is actually happening.
 */
const SLOW_AFTER_MS = 3000;
const MAX_ATTEMPTS = 3;

type WakingListener = (waking: boolean) => void;
const wakingListeners = new Set<WakingListener>();
let inFlightSlow = 0;

export function onServerWaking(cb: WakingListener): () => void {
  wakingListeners.add(cb);
  return () => wakingListeners.delete(cb);
}

function setSlow(active: boolean) {
  const before = inFlightSlow;
  inFlightSlow = Math.max(0, inFlightSlow + (active ? 1 : -1));
  const wasWaking = before > 0;
  const isWaking = inFlightSlow > 0;
  if (wasWaking !== isWaking) wakingListeners.forEach((cb) => cb(isWaking));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function api<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response | null = null;
  let lastError: any = null;
  let markedSlow = false;
  const slowTimer = setTimeout(() => {
    markedSlow = true;
    setSlow(true);
  }, SLOW_AFTER_MS);

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        res = await fetch(`${BASE}/api${path}`, { ...options, headers });
        // 502/503/504 during boot are transient — the container is starting.
        if (res.status >= 502 && res.status <= 504 && attempt < MAX_ATTEMPTS) {
          await sleep(attempt * 2000);
          continue;
        }
        lastError = null;
        break;
      } catch (e) {
        // Network-level failure (socket closed while the host wakes up).
        lastError = e;
        res = null;
        if (attempt < MAX_ATTEMPTS) await sleep(attempt * 2000);
      }
    }
  } finally {
    clearTimeout(slowTimer);
    if (markedSlow) setSlow(false);
  }

  if (!res) throw lastError ?? new Error("Sunucuya ulaşılamadı");

  if (res.status === 401) {
    await setToken(null);
    const err: any = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err: any = new Error(
      (body && (body.detail || body.message)) || `HTTP ${res.status}`
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

// Convenience helpers
export const apiPost = <T = any>(p: string, b: any) =>
  api<T>(p, { method: "POST", body: JSON.stringify(b) });
export const apiGet = <T = any>(p: string) => api<T>(p);
export const apiDelete = <T = any>(p: string) => api<T>(p, { method: "DELETE" });
