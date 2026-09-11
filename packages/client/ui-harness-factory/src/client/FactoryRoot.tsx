/**
 * The Harness Factory page: a sidebar-foot trigger plus a full-viewport
 * overlay (position:fixed, the same technique the Settings and Monitor panels
 * use). The user picks a starting template (or lets the model choose),
 * describes what they want, and gets back a harness they can run immediately
 * or download.
 *
 * Generation is slow on purpose — it runs a model call, copies a template,
 * renders it, and MOUNTS the result before answering — so the busy state says
 * what is happening rather than showing a bare spinner.
 * @module @ibrahimsaleem/dsh-client-ui-harness-factory/client/FactoryRoot
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import clsx from 'clsx'
import type { HarnessFactoryKey } from './locales.ts'
import type { GeneratedHarnessEntry, HarnessClient, HarnessTemplateEntry } from './client-face.ts'
import css from './FactoryRoot.module.css'

type Translate = (key: HarnessFactoryKey) => string

/** Props the plugin hands the occupant. */
export interface FactoryRootProps {
  wide: boolean
  client: HarnessClient
  t: Translate
}

/**
 * Trigger + overlay.
 * @param props - sidebar width state, the RPC surface, and the translator.
 * @returns the sidebar-foot button and, when open, the overlay.
 */
export function FactoryRoot({ wide, client, t }: FactoryRootProps): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={clsx(css.trigger, !wide && css.triggerRail)}
        onClick={() => { setOpen(true) }}
        title={t('title')}
      >
        <span className={css.triggerIcon} aria-hidden>✦</span>
        {wide && <span>{t('trigger')}</span>}
      </button>
      {open && <FactoryOverlay client={client} t={t} onClose={() => { setOpen(false) }} />}
    </>
  )
}

/** The overlay body: catalog, prompt, and the result view. */
function FactoryOverlay({ client, t, onClose }: { client: HarnessClient; t: Translate; onClose: () => void }): ReactElement {
  const [templates, setTemplates] = useState<readonly HarnessTemplateEntry[]>([])
  const [available, setAvailable] = useState<boolean | null>(null)
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GeneratedHarnessEntry | null>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const catalog = await client.templates(controller.signal)
        if (controller.signal.aborted) return
        setTemplates(catalog.templates)
        setAvailable(catalog.available)
      } catch {
        if (!controller.signal.aborted) setAvailable(false)
      }
    })()
    return () => { controller.abort() }
  }, [client])

  useEffect(() => { closeButton.current?.focus() }, [])

  // Escape closes, except mid-generation: a half-written preset is rolled back
  // by the host, but the user losing the result they just waited for is worse
  // than one extra click.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [busy, onClose])

  const generate = useCallback(async () => {
    if (prompt.trim().length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      setResult(await client.generate(prompt.trim(), picked))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [busy, client, picked, prompt])

  return (
    <div className={css.overlay} role="dialog" aria-modal="true" aria-label={t('title')}>
      <header className={css.header}>
        <h1 className={css.title}>{t('title')}</h1>
        <button ref={closeButton} type="button" className={css.close} onClick={onClose} disabled={busy}>
          {t('close')}
        </button>
      </header>

      <div className={css.body}>
        {available === false && (
          <div className={css.empty}>
            <p className={css.emptyTitle}>{t('unavailable')}</p>
            <p className={css.emptyHint}>{t('unavailableHint')}</p>
          </div>
        )}

        {available === true && result === null && (
          <>
            <p className={css.subtitle}>{t('subtitle')}</p>

            <h2 className={css.sectionHeading}>{t('templateHeading')}</h2>
            <div className={css.cards}>
              <TemplateCard
                selected={picked === undefined}
                label={t('templateAuto')}
                blurb={t('templateAutoBlurb')}
                phases={[]}
                phasesLabel={t('phases')}
                onPick={() => { setPicked(undefined) }}
              />
              {templates.map(template => (
                <TemplateCard
                  key={template.id}
                  selected={picked === template.id}
                  label={template.label}
                  blurb={template.blurb}
                  phases={template.phases}
                  phasesLabel={t('phases')}
                  onPick={() => { setPicked(template.id) }}
                />
              ))}
            </div>

            <h2 className={css.sectionHeading}>
              <label htmlFor="harness-prompt">{t('promptLabel')}</label>
            </h2>
            <textarea
              id="harness-prompt"
              className={css.prompt}
              value={prompt}
              rows={4}
              disabled={busy}
              placeholder={t('promptPlaceholder')}
              onChange={(event) => { setPrompt(event.target.value) }}
            />

            <div className={css.actions}>
              <button
                type="button"
                className={css.primary}
                disabled={busy || prompt.trim().length === 0}
                onClick={() => { void generate() }}
              >
                {busy ? t('generating') : t('generate')}
              </button>
              {busy && <span className={css.hint}>{t('generatingHint')}</span>}
            </div>

            {error !== null && (
              <div className={css.error}>
                <strong>{t('failed')}</strong>
                <p>{error}</p>
              </div>
            )}
          </>
        )}

        {result !== null && (
          <HarnessResult
            harness={result}
            client={client}
            t={t}
            onAgain={() => { setResult(null); setPrompt(''); setError(null) }}
          />
        )}
      </div>
    </div>
  )
}

/** One selectable starting point. */
function TemplateCard(props: {
  selected: boolean
  label: string
  blurb: string
  phases: readonly string[]
  phasesLabel: string
  onPick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      className={clsx(css.card, props.selected && css.cardSelected)}
      aria-pressed={props.selected}
      onClick={props.onPick}
    >
      <span className={css.cardLabel}>{props.label}</span>
      <span className={css.cardBlurb}>{props.blurb}</span>
      {props.phases.length > 0 && (
        <span className={css.cardPhases}>
          <span className={css.cardPhasesLabel}>{props.phasesLabel}</span>
          {props.phases.join(' → ')}
        </span>
      )}
    </button>
  )
}

/** The built harness: what it is, and the two things you can do with it. */
function HarnessResult({ harness, client, t, onAgain }: {
  harness: GeneratedHarnessEntry
  client: HarnessClient
  t: Translate
  onAgain: () => void
}): ReactElement {
  return (
    <div className={css.result}>
      <p className={css.resultKicker}>{t('resultHeading')}</p>
      <h2 className={css.resultName}>{harness.name}</h2>
      <p className={css.resultDescription}>{harness.description}</p>

      <div className={css.actions}>
        <button type="button" className={css.primary} onClick={() => { client.runHarness(harness.id) }}>
          {t('run')}
        </button>
        {/* A plain link: the host serves the archive on a GET route, so the
            browser's own download manager fetches it — no blob, no memory copy. */}
        <a className={css.secondary} href={client.downloadUrl(harness.id)} download>
          {t('download')}
        </a>
        <button type="button" className={css.secondary} onClick={onAgain}>{t('again')}</button>
      </div>

      <h3 className={css.sectionHeading}>{t('personaHeading')}</h3>
      <pre className={css.persona}>{harness.persona}</pre>

      {harness.skills.length > 0 && (
        <>
          <h3 className={css.sectionHeading}>{t('skillsHeading')}</h3>
          <ul className={css.list}>
            {harness.skills.map(skill => (
              <li key={skill.name}>
                <code>{skill.name}</code>
                <span className={css.listNote}>{skill.description}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className={css.sectionHeading}>{t('capabilitiesHeading')}</h3>
      <div className={css.chips}>
        {harness.enabled.map(capability => <span key={capability} className={css.chip}>{capability}</span>)}
      </div>

      {harness.dropped.length > 0 && (
        <>
          <h3 className={css.sectionHeading}>{t('droppedHeading')}</h3>
          <p className={css.hint}>{t('droppedHint')}</p>
          <div className={css.chips}>
            {harness.dropped.map(capability => (
              <span key={capability} className={clsx(css.chip, css.chipMuted)}>{capability}</span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
