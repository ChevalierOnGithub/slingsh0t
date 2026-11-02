import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// The web project has no vitest globals, so RTL cannot register its own auto-cleanup.
configure({ asyncUtilTimeout: 5000 })
afterEach(cleanup)
