import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.jsx'

// Remove map tiles cached by older versions (some were "API key required" placeholders).
if ('caches' in window) caches.delete('mishwaar-tiles').catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
