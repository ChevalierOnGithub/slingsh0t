import type { RecentKind } from '../../shared/types'
import { api } from './api'

/** Fire-and-forget: a failed history write must never disturb the page. */
export function recordRecent(kind: RecentKind, ref: string | number, label: string): void {
  void api('POST', '/api/recents', { kind, ref: String(ref), label }).catch(() => {})
}
