/**
 * 图标：全部内联 SVG，不引图标库。
 *
 * 只有十来个图标，按需内联比引一个包更省——也不用担心「库升级后某个图标改名」
 * 这类与业务无关的维护成本。统一 24×24 视框、`stroke` 描边、`currentColor` 上色。
 */
import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 16, children, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconPlus = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconEdit = (p: Props) => (
  <Svg {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Svg>
)

export const IconTrash = (p: Props) => (
  <Svg {...p}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
  </Svg>
)

export const IconEye = (p: Props) => (
  <Svg {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
)

export const IconUpload = (p: Props) => (
  <Svg {...p}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Svg>
)

/** 导入：箭头进托盘。与 IconUpload（箭头出托盘）方向相反，一眼能区分推上去和拉下来 */
export const IconImport = (p: Props) => (
  <Svg {...p}>
    <path d="M12 4v12M7 11l5 5 5-5" />
    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Svg>
)

/** 导出：与 IconImport 方向相反——一个是把外面拉进来，一个是把里面拿出来 */
export const IconDownload = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M5 21h14" />
  </Svg>
)

export const IconMinus = (p: Props) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
)

/** 适应窗口：四角向内收 */
export const IconFit = (p: Props) => (
  <Svg {...p}>
    <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
  </Svg>
)

/** 预览图（缩略图） */
export const IconMap = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M8 3v18M3 9h18" />
  </Svg>
)

export const IconChevronLeft = (p: Props) => (
  <Svg {...p}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
)

export const IconChevronDown = (p: Props) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)

/** 连线到目标：箭头指向一个方框 */
export const IconLink = (p: Props) => (
  <Svg {...p}>
    <rect x="13" y="8" width="8" height="8" rx="1.6" />
    <path d="M3 12h7M8 9l3 3-3 3" />
  </Svg>
)

export const IconUndo = (p: Props) => (
  <Svg {...p}>
    <path d="M3 7v6h6" />
    <path d="M3.5 13a9 9 0 1 0 2.3-9.3L3 7" />
  </Svg>
)

export const IconMoon = (p: Props) => (
  <Svg {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z" />
  </Svg>
)

export const IconSun = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </Svg>
)

export const IconClose = (p: Props) => (
  <Svg {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
)

export const IconChevronRight = (p: Props) => (
  <Svg {...p}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
)

export const IconAlert = (p: Props) => (
  <Svg {...p}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  </Svg>
)

export const IconCheck = (p: Props) => (
  <Svg {...p}>
    <path d="m20 6-11 11-5-5" />
  </Svg>
)

export const IconInfo = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-5M12 8h.01" />
  </Svg>
)

export const IconServer = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="7" rx="2" />
    <rect x="3" y="13" width="18" height="7" rx="2" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </Svg>
)

export const IconRoute = (p: Props) => (
  <Svg {...p}>
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <path d="M8.5 18H14a4 4 0 0 0 0-8H9a3 3 0 0 1 0-6h1.5" />
  </Svg>
)

export const IconScale = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3v18M5 8h14" />
    <path d="M5 8 2 15h6L5 8ZM19 8l-3 7h6l-3-7Z" />
  </Svg>
)

export const IconHistory = (p: Props) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 8v4l3 2" />
  </Svg>
)

export const IconRefresh = (p: Props) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-3-6.7" />
    <path d="M21 3v6h-6" />
  </Svg>
)

export const IconCopy = (p: Props) => (
  <Svg {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Svg>
)

export const IconTerminal = (p: Props) => (
  <Svg {...p}>
    <rect x="2.5" y="4" width="19" height="16" rx="2" />
    <path d="m7 9 3 3-3 3M13 15h4" />
  </Svg>
)

export const IconArrowUp = (p: Props) => (
  <Svg {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
)

export const IconArrowDown = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
)

/** 拖拽把手：两列小圆点，跟 macOS 列表重排的手感一致 */
export const IconGrip = (p: Props) => (
  <Svg {...p} strokeWidth={0}>
    <g fill="currentColor">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </g>
  </Svg>
)
