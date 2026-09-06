'use client'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// Session token fallback (Authorization: Bearer)
//
// The preview panel embeds this app in a cross-site iframe, where browsers
// block the session cookie (the root cause of the recurring admin
// "permission" / "statistics unavailable" failures). The login/register
// responses echo the SAME signed session JWT that is set as the httpOnly
// cookie; when the cookie is blocked we send it as a Bearer header instead.
// Server-side verification is IDENTICAL for both transports — this changes
// the transport only, never the authorization logic.
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'commhub_token'

function localStorageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage
  } catch {
    return false
  }
}

export function setSessionToken(token: string): void {
  if (!localStorageAvailable()) return
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* storage full / blocked — the cookie transport still applies */
  }
}

export function clearSessionToken(): void {
  if (!localStorageAvailable()) return
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export function getSessionToken(): string | null {
  if (!localStorageAvailable()) return null
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/** Authorization header when a fallback token exists (cookie stays primary). */
function authHeaders(): Record<string, string> {
  const token = getSessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

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
  const res = await fetch(url, { credentials: 'same-origin', headers: authHeaders() })
  return parse<T>(res)
}

export async function apiJson<T>(url: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return parse<T>(res)
}

/** Upload a single file with progress; resolves to the attachment descriptor. */
export function apiUpload(
  url: string,
  file: File,
  category: string,
  onProgress?: (pct: number) => void,
): Promise<{ url: string; fileName: string; mimeType: string; fileSize: number; fileType: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.withCredentials = true
    const bearer = getSessionToken()
    if (bearer) xhr.setRequestHeader('Authorization', `Bearer ${bearer}`)

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
