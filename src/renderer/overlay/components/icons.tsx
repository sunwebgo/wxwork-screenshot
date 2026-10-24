/** 自绘 SVG 图标（风格对齐企业微信截图工具栏，18px 线性图标） */
const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export const RectIcon = () => (
  <svg {...base}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="1" />
  </svg>
)

export const EllipseIcon = () => (
  <svg {...base}>
    <ellipse cx="12" cy="12" rx="8.5" ry="6.8" />
  </svg>
)

export const ArrowIcon = () => (
  <svg {...base}>
    <path d="M5 19 17.5 6.5" />
    <path d="M9 5.5h9v9" />
  </svg>
)

export const BrushIcon = () => (
  <svg {...base}>
    <path d="M17.5 3.5a2.1 2.1 0 0 1 3 3L9 18l-4.5 1.5L6 15z" />
  </svg>
)

export const MosaicIcon = () => (
  <svg {...base} stroke="none" fill="currentColor">
    <rect x="4" y="4" width="7" height="7" rx="1" opacity="0.95" />
    <rect x="13" y="4" width="7" height="7" rx="1" opacity="0.65" />
    <rect x="4" y="13" width="7" height="7" rx="1" opacity="0.65" />
    <rect x="13" y="13" width="7" height="7" rx="1" opacity="0.95" />
  </svg>
)

export const TextIcon = () => (
  <svg {...base}>
    <path d="M5 7V4.5h14V7" />
    <path d="M12 4.5v15" />
    <path d="M9 19.5h6" />
  </svg>
)

export const NumberIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="8.5" />
    <text
      x="12"
      y="16"
      textAnchor="middle"
      fontSize="11"
      fontWeight="bold"
      fill="currentColor"
      stroke="none"
    >
      1
    </text>
  </svg>
)

export const UndoIcon = () => (
  <svg {...base}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 6 6 6 6 0 0 1-6 6h-4" />
  </svg>
)

export const RedoIcon = () => (
  <svg {...base}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0-6 6 6 6 0 0 0 6 6h4" />
  </svg>
)

export const PinIcon = () => (
  <svg {...base}>
    <path d="M9.5 3h5l.8 6.5 2.7 3H6l2.7-3z" />
    <path d="M12 12.5V21" />
  </svg>
)

export const OcrIcon = () => (
  <svg {...base}>
    <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8" />
    <path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8" />
    <path d="M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16" />
    <path d="M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
    <path d="M8 8.5h8" />
    <path d="M8 12.5h8" />
    <path d="M8 16.5h5" />
  </svg>
)

export const DownloadIcon = () => (
  <svg {...base}>
    <path d="M12 3.5v10.5" />
    <path d="m7.5 10 4.5 4.5L16.5 10" />
    <path d="M4.5 19.5h15" />
  </svg>
)

export const CloseIcon = () => (
  <svg {...base}>
    <path d="m6 6 12 12" />
    <path d="M18 6 6 18" />
  </svg>
)

export const OkIcon = () => (
  <svg {...base}>
    <path d="m4.5 12.5 5 5L19.5 7" />
  </svg>
)
