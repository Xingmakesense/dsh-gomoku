/**
 * The Gomoku settings page (Settings → Gomoku): per-side model, thinking
 * level and system prompt, the shared Jev key, and the read-only reasoning
 * log of the current game. Everything configurable lives here; the sidebar
 * page keeps only the board and the game-start controls.
 *
 * Values are written through the module store, which persists the
 * user-adjustable subset to localStorage (the Jev key never leaves page
 * memory). The page updates live while a game is running.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { GomokuT } from './i18n.ts'
import { type GomokuKey } from './locales.ts'
import { type Thinking } from './game.ts'
import {
  getSnapshot, loadModels, patchSettings, resetSettings, subscribe,
  type ModelGroup, type ReasoningEntry, type SettingsState, type SideModel,
} from './store.ts'
import css from './Gomoku.module.css'
import { JEV_PROVIDER } from '../jev-shared.ts'
import { JevKeyEditor } from './JevKeyEditor.tsx'

/** Props of the settings page: the locale seat plus the settings shell's close. */
export type GomokuSettingsProps = PropsLocale<'gomoku'> & { close: () => void }

const THINKINGS: readonly { value: Thinking; key: GomokuKey }[] = [
  { value: 'off', key: 'thinking.off' },
  { value: 'high', key: 'thinking.high' },
  { value: 'max', key: 'thinking.max' },
]

/** One per-side model selector (keeps a persisted unknown model visible). */
function ModelSelect({
  label, value, groups, onChange,
}: {
  label: string
  value: SideModel
  groups: readonly ModelGroup[]
  onChange: (model: SideModel) => void
}) {
  const selected = value.provider !== undefined && value.model !== undefined
    ? value.provider + '/' + value.model
    : ''
  const known = groups.some(group => group.provider === value.provider
    && group.models.some(model => model.id === value.model))
  return (
    <label className={css.field}>
      <span className={css.label}>{label}</span>
      <select
        className={css.select}
        value={selected}
        onChange={(event) => {
          const [provider, ...rest] = event.target.value.split('/')
          onChange({ provider, model: rest.join('/') })
        }}
        disabled={groups.length === 0 && selected === ''}
      >
        {groups.length === 0 && selected === '' && <option value="">—</option>}
        {!known && selected !== '' && <option value={selected}>{value.model}</option>}
        {groups.map(group => (
          <optgroup key={group.provider} label={group.displayName}>
            {group.models.map(model => (
              <option key={model.id} value={group.provider + '/' + model.id}>{model.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

/**
 * One side's system-prompt editor. Starts from the stored value (or the node
 * half's default once loaded, when nothing is stored) and saves back through
 * the store — an empty value restores the default prompt.
 */
function PromptEditor({
  label, value, onSave, t,
}: {
  label: string
  value: string | undefined
  onSave: (prompt: string | undefined) => void
  t: GomokuT
}) {
  const [text, setText] = useState(value ?? '')
  const [defaultPrompt, setDefaultPrompt] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef<number | undefined>(undefined)

  // Load the node half's default prompt once, for the restore button and to
  // show what the model receives when no custom prompt is stored.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/plugins/gomoku/prompt')
      .then(response => response.json() as Promise<{ prompt?: string }>)
      .then((body) => {
        if (cancelled || body.prompt === undefined) return
        setDefaultPrompt(body.prompt)
      })
      .catch(() => { /* the editor stays usable; save still works */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Follow an external change (restore, reset, a saved prompt) without
  // clobbering text the user is still editing: the store value only changes
  // on save or reset.
  useEffect(() => {
    setText(value ?? defaultPrompt ?? '')
  }, [value, defaultPrompt])

  useEffect(() => () => { window.clearTimeout(savedTimer.current) }, [])

  const flashSaved = (): void => {
    setSaved(true)
    window.clearTimeout(savedTimer.current)
    savedTimer.current = window.setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className={css.promptArea}>
      <div className={css.promptTitle}>{label}</div>
      {loading && <div className={css.hint}>{t('panel.prompt.loading')}</div>}
      <textarea
        className={css.promptTextarea}
        value={text}
        rows={8}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
      />
      <div className={css.promptActions}>
        <button type="button" className={css.ghost} onClick={() => {
          onSave(undefined)
          setText(defaultPrompt ?? '')
        }}>
          {t('panel.prompt.restore')}
        </button>
        <button type="button" className={css.primary} onClick={() => {
          onSave(text.trim().length > 0 ? text : undefined)
          flashSaved()
        }}>
          {t('panel.prompt.save')}
        </button>
        {saved && <span className={css.flash}>{t('panel.prompt.saved')}</span>}
      </div>
    </div>
  )
}

/** One side's configuration card: model, thinking level, prompt and log. */
function SideSettings({
  title, stone, settings, logs, expanded, t, onToggle,
}: {
  title: string
  stone: 'black' | 'white'
  settings: SettingsState
  logs: readonly ReasoningEntry[]
  expanded: ReadonlySet<number>
  t: GomokuT
  onToggle: (n: number) => void
}) {
  const isBlack = stone === 'black'
  const model = isBlack ? settings.blackModel : settings.whiteModel
  const thinking = isBlack ? settings.blackThinking : settings.whiteThinking
  const prompt = isBlack ? settings.blackPrompt : settings.whitePrompt
  return (
    <section className={css.settingsCard}>
      <div className={css.settingsCardTitle}>
        <span className={css.titleStone + ' ' + (isBlack ? css.titleStoneBlack : css.titleStoneWhite)} />
        {title}
      </div>
      <ModelSelect
        label={isBlack ? t('panel.model.black') : t('panel.model.white')}
        value={model}
        groups={settings.groups}
        onChange={(next) => patchSettings(isBlack ? { blackModel: next } : { whiteModel: next })}
      />
      {model.provider === JEV_PROVIDER
        ? <p className={css.settingsNote}>{t('jev.decision.hint')}</p>
        : <div className={css.toolbar}>
          <span className={css.label}>{t('panel.thinking')}</span>
          <div className={css.segmented} role="group" aria-label={t('panel.thinking')}>
            {THINKINGS.map(level => (
              <button
                key={level.value}
                type="button"
                className={css.segButton + (thinking === level.value ? ' ' + css.segActive : '')}
                onClick={() => patchSettings(isBlack
                  ? { blackThinking: level.value }
                  : { whiteThinking: level.value })}
              >
                {t(level.key)}
              </button>
            ))}
          </div>
        </div>}
      <PromptEditor
        label={isBlack ? t('panel.prompt.black') : t('panel.prompt.white')}
        value={prompt}
        onSave={(next) => patchSettings(isBlack ? { blackPrompt: next } : { whitePrompt: next })}
        t={t}
      />
      <div className={css.reasoningList}>
        <div className={css.reasoningTitle}>{isBlack ? t('panel.log.black') : t('panel.log.white')}</div>
        {logs.length === 0 && <div className={css.hint}>{t('reasoning.empty')}</div>}
        {logs.map(entry => {
          const isExpanded = expanded.has(entry.n)
          return (
            <div key={entry.n} className={css.reasoningItem}>
              <button
                type="button"
                className={css.reasoningHeader}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? t('reasoning.collapse') : t('reasoning.expand')}
                onClick={() => onToggle(entry.n)}
              >
                <span className={css.chevron + (isExpanded ? ' ' + css.chevronOpen : '')}>▸</span>
                <span className={css.reasoningMove}>
                  {t('reasoning.move', { n: entry.n })}
                  {entry.move !== null && <span className={css.reasoningCoord}>{entry.move}</span>}
                </span>
                {entry.interrupted === true && <span className={css.errorText}>{t('status.interrupted')}</span>}
                {entry.error !== undefined && entry.interrupted !== true && <span className={css.errorText}>{entry.error}</span>}
              </button>
              {isExpanded && entry.reasoning !== '' && (
                <pre className={css.reasoningText}>{entry.reasoning}</pre>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** The settings page body. */
export function GomokuSettings({ t }: GomokuSettingsProps) {
  const { game, settings } = useSyncExternalStore(subscribe, getSnapshot)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const [resetDone, setResetDone] = useState(false)
  const resetTimer = useRef<number | undefined>(undefined)

  useEffect(() => { loadModels() }, [])
  useEffect(() => () => { window.clearTimeout(resetTimer.current) }, [])

  const toggleEntry = (n: number): void => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  const handleReset = (): void => {
    resetSettings()
    setResetDone(true)
    window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setResetDone(false), 1800)
  }

  return (
    <div className={css.settings}>
      <h2 className={css.settingsTitle}>{t('settings.title')}</h2>
      <p className={css.settingsIntro}>{t('settings.intro')}</p>

      <div className={css.settingsGrid}>
        <SideSettings
          title={t('panel.black')}
          stone="black"
          settings={settings}
          logs={game.log.filter(entry => entry.side === 'black')}
          expanded={expanded}
          t={t}
          onToggle={toggleEntry}
        />
        <SideSettings
          title={t('panel.white')}
          stone="white"
          settings={settings}
          logs={game.log.filter(entry => entry.side === 'white')}
          expanded={expanded}
          t={t}
          onToggle={toggleEntry}
        />
      </div>

      <section className={css.settingsBlock}>
        <h3 className={css.settingsHeading}>{t('settings.jev')}</h3>
        <JevKeyEditor
          configured={settings.jevApiKey.length > 0}
          onSave={(jevApiKey) => patchSettings({ jevApiKey })}
          t={t}
        />
      </section>

      <div className={css.settingsFooter}>
        <button type="button" className={css.ghost} onClick={handleReset}>{t('settings.reset')}</button>
        {resetDone && <span className={css.flash} role="status">{t('settings.reset.done')}</span>}
      </div>
    </div>
  )
}
