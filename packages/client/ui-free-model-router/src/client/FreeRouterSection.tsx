/**
 * Settings ▸ Free Model Router: a master toggle + rotation-policy select, one
 * card per shipped free platform (enable + paste key(s)), and a live list of
 * every candidate's health. Every mutation writes through the `router.*` wire
 * face and the panel re-reads the router's rebuilt state.
 * @module @ibrahimsaleem/dsh-llm-free-model-router-ui/client/FreeRouterSection
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CandidateHealth, PlatformState } from '@deepseek-ai/dsh-api-remotes/client'
import type { FreeRouterState, FreeRouterStore } from './store.ts'
import type { en } from './locales.ts'
import css from './FreeRouterSection.module.css'

/** Registration-side face for the panel. */
export interface FreeRouterInjected {
  hooks: {
    /** Panel snapshot, bound by the renderer as `useSnapshot`. */
    snapshot: SnapshotStore<FreeRouterState>
  }
  /** The panel controller (loaded on mount, refreshed after each mutation). */
  controller: FreeRouterStore
}

/** Full component props delivered by the slot outlet. */
export type FreeRouterSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.freeModelRouter'>
  & InjectFace<FreeRouterInjected>

type T = (key: keyof typeof en) => string

/** The Free Model Router settings section. */
export function FreeRouterSection(props: FreeRouterSectionProps): ReactNode {
  const { useSnapshot, controller, t } = props
  const state = useSnapshot(snapshot => snapshot)

  useEffect(() => { void controller.load() }, [controller])

  if (state.status === 'loading' && state.view === null) {
    return <p className={css.intro}>{t('loading')}</p>
  }
  if (state.status === 'error' || state.view === null) {
    return <p className={css.error} role="alert">{state.error ?? t('loadError')}</p>
  }

  const { view } = state
  return (
    <div className={css.section}>
      <p className={css.intro}>{t('intro')}</p>

      <label className={css.row}>
        <span className={css.label}>{t('enabled')}</span>
        <input
          type="checkbox"
          checked={view.enabled}
          disabled={state.busy !== null}
          onChange={(e) => { void controller.setConfig({ enabled: e.target.checked }) }}
        />
      </label>

      <label className={css.row}>
        <span className={css.label}>{t('policy')}</span>
        <select
          className={css.select}
          value={view.poolPolicy}
          disabled={state.busy !== null}
          onChange={(e) => { void controller.setConfig({ poolPolicy: e.target.value }) }}
        >
          <option value="balanced">{t('policyBalanced')}</option>
          <option value="max-quality">{t('policyMaxQuality')}</option>
          <option value="max-stability">{t('policyMaxStability')}</option>
        </select>
      </label>

      <label className={css.row}>
        <span className={css.label}>{t('keepLocal')}</span>
        <input
          type="checkbox"
          checked={view.keepLocalFallback}
          disabled={state.busy !== null}
          onChange={(e) => { void controller.setConfig({ keepLocalFallback: e.target.checked }) }}
        />
      </label>

      <div className={css.group}>
        <span className={css.groupTitle}>{t('platforms')}</span>
        {view.platforms.map(platform => (
          <PlatformCard
            key={platform.id}
            platform={platform}
            busy={state.busy}
            controller={controller}
            t={t}
          />
        ))}
      </div>

      <div className={css.group}>
        <span className={css.groupTitle}>{t('candidates')}</span>
        {view.candidates.length === 0
          ? <p className={css.hint}>{t('noCandidates')}</p>
          : view.candidates.map(candidate => (
            <CandidateRow
              key={candidate.key}
              candidate={candidate}
              current={view.currentPick?.key === candidate.key}
              t={t}
            />
          ))}
      </div>
    </div>
  )
}

interface PlatformCardProps {
  platform: PlatformState
  busy: string | null
  controller: FreeRouterStore
  t: T
}

function PlatformCard({ platform, busy, controller, t }: PlatformCardProps): ReactNode {
  const [keys, setKeys] = useState<string[]>([''])
  const [endpoint, setEndpoint] = useState(platform.endpoint ?? '')
  const [testResult, setTestResult] = useState<string | null>(null)
  const disabled = busy !== null

  const activate = (): void => {
    void controller.activatePlatform(
      platform.id,
      platform.authless ? [] : keys.map(k => k.trim()).filter(Boolean),
      platform.endpoint !== undefined || endpoint !== '' ? endpoint || undefined : undefined,
    )
  }

  return (
    <div className={css.card}>
      <div className={css.cardHead}>
        <span className={css.label}>{platform.displayName}</span>
        <span className={css.hint}>
          {platform.credentials.filter(c => c.configured).length}/{platform.credentials.length || 1}
          {platform.orgLevelLimits ? ' · org-level' : ''}
        </span>
      </div>

      {!platform.authless && keys.map((value, index) => (
        <input
          key={index}
          className={css.keyInput}
          type="password"
          autoComplete="off"
          placeholder={t('apiKey')}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const next = [...keys]
            next[index] = e.target.value
            setKeys(next)
          }}
        />
      ))}
      {platform.authless && (
        <input
          className={css.keyInput}
          type="text"
          placeholder={t('endpoint')}
          value={endpoint}
          disabled={disabled}
          onChange={(e) => { setEndpoint(e.target.value) }}
        />
      )}

      <div className={css.actions}>
        {!platform.authless && keys.length < platform.maxKeys && (
          <button type="button" className={css.select} disabled={disabled} onClick={() => { setKeys([...keys, '']) }}>
            {t('addKey')}
          </button>
        )}
        {!platform.authless && (
          <button
            type="button"
            className={css.select}
            disabled={disabled || keys[0]?.trim() === '' || keys[0] === undefined}
            onClick={() => {
              void controller.testKey(platform.id, keys[0] ?? '', endpoint || undefined).then((r) => {
                setTestResult(r.ok ? `${r.models?.length ?? 0} models` : (r.message ?? 'failed'))
              })
            }}
          >
            {t('test')}
          </button>
        )}
        <button type="button" className={css.select} disabled={disabled} onClick={activate}>
          {platform.enabled ? t('save') : t('enable')}
        </button>
        {platform.enabled && (
          <button
            type="button"
            className={css.select}
            disabled={disabled}
            onClick={() => { void controller.deactivatePlatform(platform.id) }}
          >
            {t('disable')}
          </button>
        )}
      </div>
      {testResult !== null && <p className={css.hint}>{testResult}</p>}
    </div>
  )
}

function CandidateRow({ candidate, current, t }: { candidate: CandidateHealth; current: boolean; t: T }): ReactNode {
  const badgeClass = clsx(css.badge, {
    [css.badgeCooling ?? '']: candidate.state === 'cooling',
    [css.badgeDisabled ?? '']: candidate.state === 'disabled',
  })
  const stateLabel = candidate.state === 'available'
    ? t('available')
    : candidate.state === 'cooling' ? t('cooling') : t('disabled')
  return (
    <div className={css.candidate}>
      <span>
        {current ? '▸ ' : ''}{candidate.modelId}
        <span className={css.hint}>{`  ${candidate.platformId}${candidate.keyIndex > 1 ? ` #${candidate.keyIndex}` : ''}`}</span>
      </span>
      <span>
        <span className={css.hint}>
          {candidate.requestsLastMinute}
          {candidate.rpm !== undefined ? `/${candidate.rpm}` : ''} {t('rpm')}
        </span>
        {'  '}
        <span className={badgeClass}>{stateLabel}</span>
      </span>
    </div>
  )
}
