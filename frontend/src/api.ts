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
  const res = await fetch(`${BASE}/api${path}`, { ...options, headers });
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
