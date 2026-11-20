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
import { type Thinking } from './game.ts'
import {
  clearLog, getSnapshot, loadModels, patchSettings, resetSettings, subscribe,
  type ModelGroup, type ReasoningEntry, type SettingsState, type SideModel,
} from './store.ts'
import css from './Gomoku.module.css'
import { JEV_PROVIDER } from '../jev-shared.ts'
import { JevKeyEditor } from './JevKeyEditor.tsx'
import { Dropdown } from './Dropdown.tsx'
import { useColorScheme, type ColorScheme } from './theme.ts'

/** Props of the settings page: the locale seat plus the settings shell's close. */
export type GomokuSettingsProps = PropsLocale<'gomoku'> & { close: () => void }

/** Compact token count: 940 → "940", 1234 → "1.2k". */
function formatTokens(count: number): string {
  return count >= 1000 ? (count / 1000).toFixed(1) + 'k' : String(count)
}

/** One native effort the host reports for a model. */
interface NativeEffort {
  id: string
  name: string
}

/**
 * One per-side model selector. The dropdown is themed by the plugin itself
 * (see Dropdown.tsx): a native select painted its option list with OS chrome
 * that ignored the host palette. A persisted model missing from the catalog
 * stays selectable, under its own "current selection" group, so an offline
 * provider never silently switches sides.
 */
function ModelSelect({
  label, value, groups, onChange, t, scheme,
}: {
  label: string
  value: SideModel
  groups: readonly ModelGroup[]
  onChange: (model: SideModel) => void
  t: GomokuT
  scheme: ColorScheme
}) {
  const selected = value.provider !== undefined && value.model !== undefined
    ? value.provider + '/' + value.model
    : ''
  const known = groups.some(group => group.provider === value.provider
    && group.models.some(model => model.id === value.model))
  const dropdownGroups: { label: string; options: { value: string; label: string }[] }[] =
    groups.map(group => ({
      label: group.displayName,
      options: group.models.map(model => ({
        value: group.provider + '/' + model.id,
        label: model.name,
      })),
    }))
  if (!known && selected !== '') {
    dropdownGroups.unshift({
      label: t('model.current'),
      options: [{ value: selected, label: value.model ?? selected }],
    })
  }
  return (
    <Dropdown
      label={label}
      value={selected}
      groups={dropdownGroups}
      placeholder={t('model.placeholder')}
      emptyText={t('model.empty')}
      disabled={groups.length === 0 && selected === ''}
      scheme={scheme}
      onChange={(next) => {
        const [provider, ...rest] = next.split('/')
        onChange({ provider, model: rest.join('/') })
      }}
    />
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

/**
 * One side's reasoning-effort selector. The options come from the host's
 * native model metadata (GET /plugins/gomoku/efforts) — the plugin keeps no
 * effort vocabulary of its own — plus an explicit "follow the model's default"
 * choice, which sends no effort at all.
 */
function EffortSelect({
  provider, model, value, onChange, t, scheme,
}: {
  provider: string | undefined
  model: string | undefined
  value: Thinking | undefined
  onChange: (effort: Thinking | undefined) => void
  t: GomokuT
  scheme: ColorScheme
}) {
  const [efforts, setEfforts] = useState<NativeEffort[]>([])
  const [defaultEffort, setDefaultEffort] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)

  // Resolve the selected model's native efforts; a model switch supersedes
  // the previous lookup, and a failure simply leaves the default option.
  useEffect(() => {
    if (provider === undefined || model === undefined) {
      setEfforts([])
      setDefaultEffort(undefined)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch('/plugins/gomoku/efforts?provider=' + encodeURIComponent(provider) + '&model=' + encodeURIComponent(model))
      .then(response => response.json() as Promise<{ efforts?: NativeEffort[]; default?: string }>)
      .then((body) => {
        if (cancelled) return
        setEfforts(body.efforts ?? [])
        setDefaultEffort(body.default)
      })
      .catch(() => { if (!cancelled) { setEfforts([]); setDefaultEffort(undefined) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [provider, model])

  // Say which native effort "default" currently resolves to, so the page shows
  // the host's configuration instead of an opaque word.
  const defaultName = defaultEffort !== undefined
    ? (efforts.find(effort => effort.id === defaultEffort)?.name ?? defaultEffort)
    : undefined
  const defaultLabel = defaultName !== undefined
    ? t('thinking.default') + ' · ' + defaultName
    : t('thinking.default')
  // A persisted id this model no longer declares stays visible (and is dropped
  // server-side) instead of silently looking like "default".
  const stored = value !== undefined && !efforts.some(effort => effort.id === value)
    ? [{ value, label: value }]
    : []
  const options = [
    { value: '', label: defaultLabel },
    ...efforts.map(effort => ({ value: effort.id, label: effort.name })),
    ...stored,
  ]
  return (
    <Dropdown
      label={t('panel.thinking')}
      value={value ?? ''}
      groups={[{ label: t('thinking.native'), options }]}
      placeholder={defaultLabel}
      emptyText={loading ? t('thinking.loading') : t('thinking.none')}
      disabled={provider === undefined || model === undefined}
      scheme={scheme}
      onChange={(next) => onChange(next === '' ? undefined : next)}
    />
  )
}

/** One side's configuration card: model, thinking level, prompt and log. */
function SideSettings({
  heading, stone, settings, logs, expanded, t, onToggle, scheme,
}: {
  heading: string
  stone: 'black' | 'white'
  settings: SettingsState
  logs: readonly ReasoningEntry[]
  expanded: ReadonlySet<number>
  t: GomokuT
  onToggle: (n: number) => void
  scheme: ColorScheme
}) {
  const isBlack = stone === 'black'
  const model = isBlack ? settings.blackModel : settings.whiteModel
  const thinking = isBlack ? settings.blackThinking : settings.whiteThinking
  const prompt = isBlack ? settings.blackPrompt : settings.whitePrompt
  return (
    <section className={css.settingsCard}>
      <div className={css.settingsCardTitle}>
        <span className={css.titleStone + ' ' + (isBlack ? css.titleStoneBlack : css.titleStoneWhite)} />
        {heading}
      </div>
      <ModelSelect
        label={isBlack ? t('panel.model.black') : t('panel.model.white')}
        value={model}
        groups={settings.groups}
        onChange={(next) => patchSettings(isBlack ? { blackModel: next } : { whiteModel: next })}
        t={t}
        scheme={scheme}
      />
      {model.provider === JEV_PROVIDER
        ? <p className={css.settingsNote}>{t('jev.decision.hint')}</p>
        : <EffortSelect
          provider={model.provider}
          model={model.model}
          value={thinking}
          onChange={(next) => patchSettings(isBlack
            ? { blackThinking: next }
            : { whiteThinking: next })}
          t={t}
          scheme={scheme}
        />}
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
                {entry.durationMs !== undefined && (
                  <span className={css.reasoningMeta}>
                    {t('reasoning.duration', { s: (entry.durationMs / 1000).toFixed(1) })}
                  </span>
                )}
                {entry.attempts !== undefined && entry.attempts > 1 && (
                  <span className={css.reasoningMeta}>{t('reasoning.attempts', { n: entry.attempts })}</span>
                )}
                {entry.inputTokens !== undefined && entry.outputTokens !== undefined && (
                  <span className={css.reasoningMeta}>
                    {t('reasoning.tokens', {
                      i: formatTokens(entry.inputTokens),
                      o: formatTokens(entry.outputTokens),
                    })}
                  </span>
                )}
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
  const [logCleared, setLogCleared] = useState(false)
  const resetTimer = useRef<number | undefined>(undefined)
  const logTimer = useRef<number | undefined>(undefined)
  // Publish the host's active appearance on this page's root so native chrome
  // (scrollbars, carets, the OS-drawn parts of inputs) matches the palette.
  const rootRef = useRef<HTMLDivElement>(null)
  const scheme = useColorScheme(rootRef)

  useEffect(() => { loadModels() }, [])
  useEffect(() => () => {
    window.clearTimeout(resetTimer.current)
    window.clearTimeout(logTimer.current)
  }, [])

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

  /** Drop both the page log and the node half's diagnostics ring. */
  const handleClearLog = (): void => {
    clearLog()
    void fetch('/plugins/gomoku/log', { method: 'DELETE' }).catch(() => { /* log already cleared locally */ })
    setLogCleared(true)
    window.clearTimeout(logTimer.current)
    logTimer.current = window.setTimeout(() => setLogCleared(false), 1800)
  }

  return (
    <div
      className={css.settings}
      ref={rootRef}
      data-gomoku-theme={scheme}
      style={{ colorScheme: scheme }}
    >
      <h2 className={css.settingsTitle}>{t('settings.title')}</h2>
      <p className={css.settingsIntro}>{t('settings.intro')}</p>

      <div className={css.settingsGrid}>
        <SideSettings
          heading={t('panel.black')}
          stone="black"
          settings={settings}
          logs={game.log.filter(entry => entry.side === 'black')}
          expanded={expanded}
          t={t}
          onToggle={toggleEntry}
          scheme={scheme}
        />
        <SideSettings
          heading={t('panel.white')}
          stone="white"
          settings={settings}
          logs={game.log.filter(entry => entry.side === 'white')}
          expanded={expanded}
          t={t}
          onToggle={toggleEntry}
          scheme={scheme}
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
        <button type="button" className={css.ghost} onClick={handleClearLog}>{t('settings.log.clear')}</button>
        {logCleared && <span className={css.flash} role="status">{t('settings.log.cleared')}</span>}
        <button type="button" className={css.ghost} onClick={handleReset}>{t('settings.reset')}</button>
        {resetDone && <span className={css.flash} role="status">{t('settings.reset.done')}</span>}
      </div>
    </div>
  )
}