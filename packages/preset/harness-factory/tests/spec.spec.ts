import { describe, expect, it } from 'vitest'
import { parseHarnessSpec } from '../src/spec.ts'
import { toggleAllowlist, HARNESS_TEMPLATES } from '../src/templates.ts'
import type { SpecValidationContext } from '../src/spec.ts'

const CONTEXT: SpecValidationContext = {
  templates: HARNESS_TEMPLATES.map(template => template.id),
  toggles: toggleAllowlist(),
  taken: ['standard', 'harness-security'],
}

/** A minimal spec that passes; individual tests break one field at a time. */
function goodSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    template: 'security',
    id: 'my-scanner',
    name: 'My Scanner',
    description: 'Scans a repo.',
    persona: 'You are a scanner.',
    skills: [{ name: 'scan-methodology', description: 'How to scan.', body: '# Scan\n\nDo it.' }],
    enable: ['web-search'],
    ...overrides,
  }
}

describe('parseHarnessSpec', () => {
  it('accepts a well-formed spec and trims its strings', () => {
    const result = parseHarnessSpec(goodSpec({ name: '  My Scanner  ' }), CONTEXT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.name).toBe('My Scanner')
    expect(result.spec.template).toBe('security')
    expect(result.spec.skills).toHaveLength(1)
  })

  it('rejects a template that is not in the catalog', () => {
    const result = parseHarnessSpec(goodSpec({ template: 'nonsense' }), CONTEXT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.join(' ')).toContain('"template" must be one of')
  })

  it('rejects an id that is not a safe directory name', () => {
    for (const id of ['Has Caps', '../escape', 'trailing/slash', '-leading-dash', 'under_score']) {
      const result = parseHarnessSpec(goodSpec({ id }), CONTEXT)
      expect(result.ok, `expected ${id} to be rejected`).toBe(false)
    }
  })

  it('rejects an id already on the roster', () => {
    const result = parseHarnessSpec(goodSpec({ id: 'harness-security' }), CONTEXT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.join(' ')).toContain('already taken')
  })

  it('rejects a skill name that could escape the preset directory', () => {
    for (const name of ['../../etc', 'a/b', 'C:\\windows', '..']) {
      const result = parseHarnessSpec(
        goodSpec({ skills: [{ name, description: 'x', body: 'y' }] }),
        CONTEXT,
      )
      expect(result.ok, `expected ${name} to be rejected`).toBe(false)
    }
  })

  it('drops unknown toggles instead of honouring them or failing', () => {
    const result = parseHarnessSpec(
      goodSpec({ enable: ['web-search', 'become-root', 'disable-sandbox'] }),
      CONTEXT,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.enable).toEqual(['web-search'])
    expect(result.dropped).toEqual(['become-root', 'disable-sandbox'])
  })

  it('de-duplicates repeated toggles', () => {
    const result = parseHarnessSpec(goodSpec({ enable: ['web-search', 'web-search'] }), CONTEXT)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.enable).toEqual(['web-search'])
  })

  it('rejects two skills sharing a name', () => {
    const result = parseHarnessSpec(goodSpec({
      skills: [
        { name: 'same', description: 'a', body: 'a' },
        { name: 'same', description: 'b', body: 'b' },
      ],
    }), CONTEXT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.join(' ')).toContain('two entries named')
  })

  it('reports every missing required field at once, so one repair can fix them all', () => {
    const result = parseHarnessSpec({ template: 'security' }, CONTEXT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    const joined = result.problems.join(' ')
    for (const field of ['id', 'name', 'description', 'persona']) {
      expect(joined, `expected a problem naming ${field}`).toContain(`"${field}"`)
    }
  })

  it('rejects a non-object payload', () => {
    for (const input of [null, 42, 'text', [1, 2]]) {
      expect(parseHarnessSpec(input, CONTEXT).ok).toBe(false)
    }
  })

  it('rejects an over-long field rather than truncating it', () => {
    const result = parseHarnessSpec(goodSpec({ name: 'x'.repeat(500) }), CONTEXT)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problems.join(' ')).toContain('at most')
  })
})
