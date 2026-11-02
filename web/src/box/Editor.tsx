import { useEffect, useRef } from 'react'
import { Compartment } from '@codemirror/state'
import { EditorView, minimalSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'

const theme = EditorView.theme(
  {
    '&': { background: 'var(--rail)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px' },
    '&.cm-focused': { outline: 'none', borderColor: 'var(--accent)' },
    '.cm-scroller': { font: '13px/1.7 var(--mono)' },
    '.cm-content': { padding: '10px 4px', caretColor: 'var(--accent)' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    // The default highlight colours are tuned for light backgrounds; keep its bold/italic only.
    '.cm-line span': { color: 'inherit' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: 'var(--accent-border)' },
  },
  { dark: true },
)

export function Editor({ value, onChange, label, autoFocus }: { value: string; onChange(v: string): void; label: string; autoFocus?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const change = useRef(onChange)
  change.current = onChange
  // The label moves with phase changes and reorders ("Recon 1" -> "PrivEsc 2"); a compartment swaps it in place.
  const labelled = useRef(new Compartment())
  const aria = (l: string) => EditorView.contentAttributes.of({ 'aria-label': l })

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      doc: value,
      extensions: [
        minimalSetup,
        markdown(),
        theme,
        EditorView.lineWrapping,
        labelled.current.of(aria(label)),
        EditorView.updateListener.of((u) => u.docChanged && change.current(u.state.doc.toString())),
      ],
    })
    view.current = v
    if (autoFocus) v.focus()
    return () => v.destroy()
  }, [])

  useEffect(() => { view.current?.dispatch({ effects: labelled.current.reconfigure(aria(label)) }) }, [label])

  // External edits (Toolbox insert) replace the doc; our own edits already match.
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  return <div ref={host} />
}
