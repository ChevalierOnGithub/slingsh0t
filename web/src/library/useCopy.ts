import { useEffect, useRef, useState } from 'react'

/** Copy button label ('Copy' → 'Copied' for 1.5 s, or 'Copy failed') and the copy action; a rejected clipboard never goes unhandled. */
export function useCopy(): [label: string, copy: (text: string) => void] {
  const [label, setLabel] = useState('Copy')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = (text: string) => {
    clearTimeout(timer.current) // a second click restarts the 1.5 s instead of being cut short by the first timer
    navigator.clipboard.writeText(text).then(
      () => { setLabel('Copied'); timer.current = setTimeout(() => setLabel('Copy'), 1500) },
      () => setLabel('Copy failed'),
    )
  }
  return [label, copy]
}
