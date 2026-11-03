export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

let token: string | undefined
export const getToken = () =>
  (token ??= document.querySelector<HTMLMetaElement>('meta[name="slingsh0t-token"]')?.content ?? '')

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    // Fastify rejects an empty body declared as JSON, so only bodied requests carry the type.
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), 'x-slingsh0t-token': getToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.message ?? data?.error ?? res.statusText)
  return data as T
}

export async function upload<T>(path: string, file: Blob, name: string): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': file.type, 'x-file-name': encodeURIComponent(name), 'x-slingsh0t-token': getToken() },
    body: file,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.message ?? data?.error ?? res.statusText)
  return data as T
}
