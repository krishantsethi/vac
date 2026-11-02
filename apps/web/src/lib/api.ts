import { getToken, removeToken } from "./auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

async function request(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) || {} };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    removeToken();
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/app")) {
      window.location.href = "/login?session=expired";
    }
  }
  return res;
}

export async function api<T>(input: RequestInfo, init: RequestInit = {}): Promise<T> {
  const res = await request(input, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail || `Request failed ${res.status}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export const API = {
  get: (path: string) => api<any>(`${API_BASE}${path}`),
  post: (path: string, body?: any) =>
    api<any>(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: (path: string, body?: any) =>
    api<any>(`${API_BASE}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: (path: string, body?: any) =>
    api<any>(`${API_BASE}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: (path: string) => api<any>(`${API_BASE}${path}`, { method: "DELETE" }),
  postForm: async (path: string, formData: FormData) => {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await request(`${API_BASE}${path}`, { method: "POST", headers, body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Upload failed ${res.status}`);
    }
    return res.json();
  },
};
