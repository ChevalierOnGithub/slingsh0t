import { ApiError, getToken } from './api'

export const saveBlob = (name: string, blob: Blob): void => {
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000) // some browsers lose the download if revoked at once
}

/** Fetch a file with the token and hand it to the browser as a download. */
export async function apiDownload(method: string, path: string): Promise<void> {
  const res = await fetch(path, { method, headers: { 'x-slingsh0t-token': getToken() } })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new ApiError(res.status, data?.message ?? data?.error ?? res.statusText)
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'download'
  saveBlob(name, await res.blob())
}
