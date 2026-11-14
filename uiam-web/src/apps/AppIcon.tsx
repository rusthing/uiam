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
    default:
      return (
        <Glyph>
          <rect x="4" y="4" width="16" height="16" rx="3" />
        </Glyph>
      )
  }
}
