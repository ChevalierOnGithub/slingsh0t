import { useEffect, useRef, useState } from 'react'

export const LOST_EVENT = 'slingsh0t:lost'

/** Tells the Shell's banner that an edit never reached the server. */
export function reportLost(what: string, message: string): void {
  dispatchEvent(new CustomEvent(LOST_EVENT, { detail: `Your last edit to ${what} was not saved: ${message}` }))
}

/**
 * A text field saved through `send`: flush on blur, flush on unmount (in-app navigation has no blur),
 * guard unload while unsaved. A failed unmount flush is reported app-wide via `reportLost`.
 */
export function useAutosave(server: string, send: (text: string) => Promise<unknown>, what: string) {
  const [value, setValue] = useState(server)
  const [saved, setSaved] = useState(server)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Latest render's values, for flushes that outlive it (unmount, an await).
  const live = useRef({ value, saved, send, what })
  live.current = { value, saved, send, what }
  const dirty = value !== saved

  useEffect(() => {
    if (live.current.value === live.current.saved) setValue(server)
    live.current.saved = server
    setSaved(server)
  }, [server])

  const flush = async () => {
    const { value: text, saved, send } = live.current
    if (text === saved) return setError(null)
    setSaving(true)
    try {
      await send(text)
      live.current.saved = text
      setSaved(text)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => () => {
    const { value: text, saved, send, what } = live.current
    if (text !== saved) send(text).catch((e: Error) => reportLost(what, e.message))
  }, [])

  useEffect(() => {
    if (!dirty) return
    const guard = (e: BeforeUnloadEvent) => e.preventDefault()
    addEventListener('beforeunload', guard)
    return () => removeEventListener('beforeunload', guard)
  }, [dirty])

  const status = saving ? 'Saving…' : !dirty ? 'Saved' : error ? 'Not saved' : 'Unsaved'
  return { value, onChange: setValue, flush, status, error } as const
}
