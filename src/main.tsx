import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/material-symbols-outlined/400.css'
import '@fontsource/material-symbols-rounded/400.css'
import '@/i18n'
import '@/styles/tailwind.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
