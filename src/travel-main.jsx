import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import TravelApp from './travel-app.jsx'
import '../my-travel-app/src/index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TravelApp />
  </StrictMode>,
)
