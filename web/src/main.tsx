import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { consumeAuthRedirect } from './auth/authRedirect.ts'

const initialAuthIntent = consumeAuthRedirect(
  new URL(window.location.href),
  (sanitizedPath) => window.history.replaceState(null, '', sanitizedPath),
)

createRoot(document.getElementById('root')!).render(
  <App initialAuthIntent={initialAuthIntent} />,
)
