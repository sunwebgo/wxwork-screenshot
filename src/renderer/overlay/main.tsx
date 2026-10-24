import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// 截图遮罩内禁用 Ctrl+滚轮缩放，避免误改页面比例导致坐标失真
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault()
}, { passive: false })

createRoot(document.getElementById('root')!).render(<App />)
