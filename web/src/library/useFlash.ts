import { useEffect } from 'react'

/** Scrolls the element with this id into view and outlines it for 2 s (search and "Used on" landings). */
export function useFlash(id: string | null) {
  useEffect(() => {
    const el = id ? document.getElementById(id) : null
    if (!el) return
    el.scrollIntoView?.({ block: 'center' }) // optional call: jsdom has no scrollIntoView
    el.classList.add('flash')
    const t = setTimeout(() => el.classList.remove('flash'), 2000)
    return () => { clearTimeout(t); el.classList.remove('flash') }
  }, [id])
}
