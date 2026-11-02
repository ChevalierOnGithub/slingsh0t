import type { Difficulty } from '../../shared/types'

export type HtbMachine = { id: number; name: string; os: string; difficulty: Difficulty; releaseDate: string | null; userOwned: boolean; rootOwned: boolean }

const DIFFICULTIES: readonly string[] = ['Easy', 'Medium', 'Hard', 'Insane'] satisfies Difficulty[]

/** One raw HTB v4 list item -> HtbMachine; null when id/name are malformed or the difficulty is unknown. */
export function mapMachine(raw: Record<string, unknown>): HtbMachine | null {
  // `difficulty` is a numeric rating on list items, so only a string value counts as the label.
  const text = [raw.difficultyText, raw.difficulty_text, raw.difficulty].find((v) => typeof v === 'string') as string | undefined
  const difficulty = text && text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
  if (typeof raw.id !== 'number' || typeof raw.name !== 'string' || !difficulty || !DIFFICULTIES.includes(difficulty)) return null
  const release = raw.release ?? raw.release_date
  return {
    id: raw.id,
    name: raw.name,
    os: typeof raw.os === 'string' ? raw.os : '',
    difficulty: difficulty as Difficulty,
    releaseDate: typeof release === 'string' ? release : null,
    userOwned: Boolean(raw.authUserInUserOwns),
    rootOwned: Boolean(raw.authUserInRootOwns),
  }
}
