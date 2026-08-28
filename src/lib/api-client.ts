'use client'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
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
  const res = await fetch(url, { credentials: 'same-origin' })
  return parse<T>(res)
}

export async function apiJson<T>(url: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
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
