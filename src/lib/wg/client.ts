"use client";

// Work Guideline API transport. Endpoints are namespaced so no existing
// Muxamil API route can be shadowed. Mutations reuse Muxamil's CSRF token.
function endpoint(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (clean.startsWith("/api/work-guideline/")) return clean;
  if (clean.startsWith("/api/")) return `/api/work-guideline${clean.slice(4)}`;
  return clean;
}

function csrfHeaders(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const match = document.cookie.match(/(?:^|;\s*)commhub_csrf=([^;]+)/);
  return match ? { "X-CSRF-Token": decodeURIComponent(match[1]) } : {};
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const res = await fetch(endpoint(path), {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...csrfHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  let data: Record<string, unknown> = {};
  try { data = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON response */ }
  if (!res.ok) {
    const err = new Error((data.error as string) || `Request failed (${res.status}).`) as Error & { data?: Record<string, unknown> };
    err.data = data;
    throw err;
  }
  return data as T;
}

export function uploadWithProgress<T = unknown>(path: string, form: FormData, onProgress?: (percent: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint(path));
    xhr.withCredentials = true;
    for (const [key, value] of Object.entries(csrfHeaders())) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(xhr.responseText) as Record<string, unknown>; } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new Error((data.error as string) || `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(form);
  });
}
