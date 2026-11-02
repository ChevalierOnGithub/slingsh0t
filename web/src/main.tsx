import { createRoot } from 'react-dom/client'
import './theme.css'
import { ContextProvider } from './shell/TargetBar'
import { Shell } from './shell/Shell'

createRoot(document.getElementById('root')!).render(
  <ContextProvider>
    <Shell />
  </ContextProvider>,
)
