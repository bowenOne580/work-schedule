const BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8998'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (res.status === 401) {
    window.location.href = '/login'
    throw new Error('AUTH_REQUIRED')
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return undefined as T
  }
  const json = await res.json()
  if (!res.ok) throw json.error
  return json.data ?? json
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
