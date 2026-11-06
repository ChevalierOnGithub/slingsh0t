import { useEffect, useState } from 'react'
import type { BoxDetail, NetworkDetail } from '../../../shared/types'
import { api } from '../api'
import { useWorkItem } from '../box/WorkItem'
import { recordRecent } from '../recents'
import { Report } from '../report/Report'
import './library.css'

/** One box's or network's writeup report, reached from the Writeups index. */
export function WriteupPage({ kind, id }: { kind: 'box' | 'network'; id: number }) {
  return kind === 'box' ? <BoxWriteup id={id} /> : <NetworkWriteup id={id} />
}

function BoxWriteup({ id }: { id: number }) {
  const { item: box, error } = useWorkItem<BoxDetail>(`/api/boxes/${id}`)
  useEffect(() => { if (box) recordRecent('writeup', box.id, box.name) }, [box?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!box) return error ? <p className="err" role="alert">{error}</p> : null
  return (
    <section className="lib">
      <h1>{box.name} <span className="sid">{box.shortId}</span> <a className="btn" href={`#/boxes/${box.id}`}>Go to box</a></h1>
      <Report item={box} ownerPath={`/api/boxes/${id}`} active />
    </section>
  )
}

function NetworkWriteup({ id }: { id: number }) {
  const [net, setNet] = useState<NetworkDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api<NetworkDetail>('GET', `/api/networks/${id}`).then(setNet, (e) => setErr(e.message)) }, [id])
  useEffect(() => { if (net) recordRecent('network-writeup', net.id, net.name) }, [net?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!net) return err ? <p className="err" role="alert">{err}</p> : null
  return (
    <section className="lib">
      <h1>{net.name} <span className="sid">{net.shortId}</span> <a className="btn" href={`#/networks/${id}`}>Go to network</a></h1>
      <Report item={net} ownerPath={`/api/networks/${id}`} summary={false} active />
    </section>
  )
}
