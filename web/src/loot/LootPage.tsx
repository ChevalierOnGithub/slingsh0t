import { CredentialsTable } from './CredentialsTable'

export function LootPage() {
  return (
    <section>
      <h1>Loot</h1>
      <p className="hint">Credentials from every network and box. Add new ones on the network or box page they belong to.</p>
      <CredentialsTable scope={{ all: true }} />
    </section>
  )
}
