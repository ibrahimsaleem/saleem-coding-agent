// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, within } from '@testing-library/react'
import { FileTypeIcon } from '../src/client/file-icon.tsx'

afterEach(cleanup)

/** Number of `<text>` (monogram badge) nodes rendered — 0 means the plain fallback glyph. */
function badgeCount(container: HTMLElement): number {
  return container.querySelectorAll('text').length
}

describe('FileTypeIcon', () => {
  it('renders a monogram badge for a recognized extension', () => {
    const { container, getByText } = render(<FileTypeIcon name="index.ts" />)
    expect(badgeCount(container)).toBe(1)
    expect(getByText('TS')).toBeTruthy()
  })

  it('falls back to the plain file glyph for an unrecognized extension', () => {
    const { container } = render(<FileTypeIcon name="notes.xyz123" />)
    expect(badgeCount(container)).toBe(0)
  })

  it('falls back to the plain file glyph for a name with no extension', () => {
    const { container } = render(<FileTypeIcon name="LICENSE_NOT_LISTED" />)
    expect(badgeCount(container)).toBe(0)
  })

  it('matches case-insensitively', () => {
    const { getByText } = render(<FileTypeIcon name="Main.PY" />)
    expect(getByText('PY')).toBeTruthy()
  })

  it('resolves aliased extension spellings to their canonical badge', () => {
    expect(within(render(<FileTypeIcon name="worker.mjs" />).container).getByText('JS')).toBeTruthy()
    expect(within(render(<FileTypeIcon name="app.cjs" />).container).getByText('JS')).toBeTruthy()
    expect(within(render(<FileTypeIcon name="module.mts" />).container).getByText('TS')).toBeTruthy()
  })

  it('shares one badge across a language family (.ts and .tsx)', () => {
    expect(within(render(<FileTypeIcon name="a.ts" />).container).getByText('TS')).toBeTruthy()
    expect(within(render(<FileTypeIcon name="a.tsx" />).container).getByText('TS')).toBeTruthy()
  })

  it('recognizes exact conventional filenames with no extension', () => {
    expect(within(render(<FileTypeIcon name="Dockerfile" />).container).getByText('DK')).toBeTruthy()
    expect(within(render(<FileTypeIcon name="README" />).container).getByText('MD')).toBeTruthy()
  })

  it('recognizes dotfiles by their full name, not a spurious extension', () => {
    const { getByText } = render(<FileTypeIcon name=".gitignore" />)
    expect(getByText('GI')).toBeTruthy()
  })

  it('recognizes .env and its suffixed variants (.env.local, .env-production)', () => {
    expect(within(render(<FileTypeIcon name=".env" />).container).getByText('EN')).toBeTruthy()
    expect(within(render(<FileTypeIcon name=".env.local" />).container).getByText('EN')).toBeTruthy()
    expect(within(render(<FileTypeIcon name=".env-production" />).container).getByText('EN')).toBeTruthy()
  })

  it('forwards className to the rendered icon in both the badge and fallback paths', () => {
    const { container: badge } = render(<FileTypeIcon name="a.ts" className="my-class" />)
    expect(badge.querySelector('svg.my-class')).toBeTruthy()
    const { container: fallback } = render(<FileTypeIcon name="a.xyz123" className="my-class" />)
    expect(fallback.querySelector('svg.my-class')).toBeTruthy()
  })
})
