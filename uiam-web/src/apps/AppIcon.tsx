/**
 * 应用图标：24×24 视框、描边、`currentColor` 上色，塞进 `.tile` 渐变块里用。
 *
 * 与业务图标（components/icons.tsx）分开：那些是 16px 的界面图标，这几个要放到
 * 68px 的启动台磁贴里，线条粗细和视觉重心都不一样。
 */
import type { SVGProps } from 'react'

function Glyph({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function AppIcon({ id }: { id: string }) {
  switch (id) {
    case 'gateway':
      return (
        <Glyph>
          <rect x="3" y="4" width="18" height="6.4" rx="2" />
          <rect x="3" y="13.6" width="18" height="6.4" rx="2" />
          <path d="M6.6 7.2h.01M6.6 16.8h.01" />
          <path d="M10.4 7.2h6M10.4 16.8h6" />
        </Glyph>
      )
    case 'api':
      return (
        <Glyph>
          <path d="m8.6 8-4 4 4 4M15.4 8l4 4-4 4" />
          <path d="M13.4 6.4 10.6 17.6" />
        </Glyph>
      )
    case 'settings':
      return (
        <Glyph>
          <path d="M3.6 7.4h9.2M17.6 7.4h2.8M3.6 16.6h4.4M12.8 16.6h7.6" />
          <circle cx="15.2" cy="7.4" r="2.3" />
          <circle cx="10.4" cy="16.6" r="2.3" />
        </Glyph>
      )
    case 'about':
      return (
        <Glyph>
          <circle cx="12" cy="12" r="8.6" />
          <path d="M12 16.2v-4.6M12 8.2h.01" />
        </Glyph>
      )
    case 'msg':
      return (
        <Glyph>
          <rect x="3" y="5" width="18" height="14" rx="2.4" />
          <path d="m3.8 6.4 8.2 6 8.2-6" />
        </Glyph>
      )
    case 'alarm':
      return (
        <Glyph>
          <path d="M6.4 16.2V10a5.6 5.6 0 0 1 11.2 0v6.2l1.6 2H4.8z" />
          <path d="M10 19.4a2.2 2.2 0 0 0 4 0" />
        </Glyph>
      )
    case 'dbz':
      return (
        <Glyph>
          <ellipse cx="12" cy="6.2" rx="7.4" ry="2.8" />
          <path d="M4.6 6.2v11.6c0 1.5 3.3 2.8 7.4 2.8s7.4-1.3 7.4-2.8V6.2" />
          <path d="M4.6 12c0 1.5 3.3 2.8 7.4 2.8s7.4-1.3 7.4-2.8" />
        </Glyph>
      )
    case 'syn':
      return (
        <Glyph>
          <path d="M4 8.4h13l-3-3M20 15.6H7l3 3" />
        </Glyph>
      )
    case 'adm':
      return (
        <Glyph>
          <path d="M12 3.2 4.8 6v5.4c0 4.4 3 8.3 7.2 9.4 4.2-1.1 7.2-5 7.2-9.4V6z" />
          <path d="M9.4 12l1.8 1.8 3.4-3.6" />
        </Glyph>
      )
    case 'dtw':
      return (
        <Glyph>
          <path d="M12 21s6-5.2 6-10.2a6 6 0 1 0-12 0C6 15.8 12 21 12 21z" />
          <circle cx="12" cy="10.6" r="2.2" />
        </Glyph>
      )
    case 'jobx':
      return (
        <Glyph>
          <circle cx="12" cy="12" r="8.6" />
          <path d="M12 7v5.4l3.4 2" />
        </Glyph>
      )
    default:
      return (
        <Glyph>
          <rect x="4" y="4" width="16" height="16" rx="3" />
        </Glyph>
      )
  }
}
