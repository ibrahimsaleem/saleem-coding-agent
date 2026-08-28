import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type SaleemBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the Saleem Harness mark with the presentation requested by its host
 * surface. Deliberately plain text, not a reused DeepSeek asset — see
 * BRAND_GUIDELINES.md.
 * @param props - Host-supplied mark presentation.
 * @returns the Saleem mark.
 */
export function SaleemBrandMark({ size, className }: SaleemBrandMarkProps) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        fontSize: size * 0.6,
        fontWeight: 700,
      }}
      aria-hidden="true"
    >
      ◆
    </span>
  )
}

/**
 * Render the Saleem Harness name.
 * @returns the Saleem name wordmark.
 */
export function SaleemBrandName() {
  return <span style={{ fontWeight: 600 }}>Saleem Harness</span>
}
