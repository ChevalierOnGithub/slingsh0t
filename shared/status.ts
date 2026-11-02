import type { BoxStatus } from './types'

/** Box and host statuses in progress order, with their labels. */
export const STATUSES: [BoxStatus, string][] = [['not_started', 'Not started'], ['in_progress', 'In progress'], ['user_flag', 'User flag'], ['rooted', 'Rooted']]
export const STATUS_LABEL = Object.fromEntries(STATUSES) as Record<BoxStatus, string>
