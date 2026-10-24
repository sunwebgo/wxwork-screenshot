import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// 贴图窗口内禁用 Ctrl+滚轮缩放，滚轮仅用于缩放贴图本身
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault()
}, { passive: false })

createRoot(document.getElementById('root')!).render(<App />)
