'use client'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Double-submit CSRF headers. src/proxy.ts issues a non-HttpOnly
 * `commhub_csrf` cookie and requires every mutating request that carries it
 * to echo the value back in the `X-CSRF-Token` header — a cross-site page
 * cannot read the cookie, so it can never forge the header. Attached by
 * apiJson/apiUpload and by the raw multipart upload call sites. */
export function csrfHeaders(): Record<string, string> {
  if (typeof document === 'undefined') return {}
  const m = document.cookie.match(/(?:^|;\s*)commhub_csrf=([^;]+)/)
  const token = m ? decodeURIComponent(m[1]) : ''
  return token ? { 'X-CSRF-Token': token } : {}
}

/** Offline / DNS / connection-drop errors must never surface the browser's raw
 *  TypeError ("Failed to fetch") in a toast — translate to a friendly message.
 *  HTTP-level errors are already friendly via parse() below. */
const NETWORK_ERROR = 'Network error — please check your connection and try again.'

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) || 'Something went wrong. Please try again.'
    throw new ApiError(message, res.status)
  }
  return data as T
}

export async function apiGet<T>(url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { credentials: 'same-origin' })
  } catch {
    throw new ApiError(NETWORK_ERROR, 0)
  }
  return parse<T>(res)
}

export async function apiJson<T>(url: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new ApiError(NETWORK_ERROR, 0)
  }
  return parse<T>(res)
}

/** Upload a single file with progress; resolves to the attachment descriptor. */
export function apiUpload(
  url: string,
  file: File,
  category: string,
  onProgress?: (pct: number) => void,
): Promise<{ url: string; path: string; fileName: string; mimeType: string; fileSize: number; fileType: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.withCredentials = true
    for (const [k, v] of Object.entries(csrfHeaders())) xhr.setRequestHeader(k, v)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText)
        if (xhr.status >= 200 && xhr.status < 300) resolve(data)
        else reject(new ApiError(data?.error || 'Upload failed.', xhr.status))
      } catch {
        reject(new ApiError('Upload failed.', xhr.status))
      }
    }
    xhr.onerror = () => reject(new ApiError('Upload failed — network error.', 0))
    xhr.onabort = () => reject(new ApiError('Upload cancelled.', 0))

    const form = new FormData()
    form.append('category', category)
    form.append('file', file)
    xhr.send(form)
  })
}
