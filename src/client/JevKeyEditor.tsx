import { useId, useState } from 'react'
import { isValidJevApiKey } from '../jev-shared.ts'
import type { GomokuT } from './GomokuView.tsx'
import css from './Gomoku.module.css'

/** Saved keys stay in page memory and never refill the password input. */
export function JevKeyEditor({ configured, onSave, t }: {
  configured: boolean
  onSave: (key: string) => void
  t: GomokuT
}) {
  const id = useId()
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)
  return (
    <form className={css.jevKey} onSubmit={event => {
      event.preventDefault()
      if (!isValidJevApiKey(draft)) { setInvalid(true); return }
      onSave(draft.trim())
      setDraft('')
      setInvalid(false)
    }}>
      <label className={css.field} htmlFor={id}>
        <span className={css.label}>{t('jev.key.label')}</span>
        <input
          id={id} className={css.select} type="password" value={draft}
          placeholder={configured ? t('jev.key.replace') : t('jev.key.placeholder')}
          autoComplete="off" spellCheck={false} maxLength={4096}
          aria-describedby={id + '-hint'} aria-invalid={invalid}
          onChange={event => { setDraft(event.target.value); setInvalid(false) }}
        />
      </label>
      <p id={id + '-hint'} className={css.hint}>{t('jev.key.hint')}</p>
      <div className={css.promptActions}>
        <button type="submit" className={css.primary} disabled={!draft.trim()}>{t('jev.key.save')}</button>
        {configured && <button type="button" className={css.ghost} onClick={() => {
          onSave(''); setDraft(''); setInvalid(false)
        }}>{t('jev.key.clear')}</button>}
        <span className={css.hint} role="status">{configured ? t('jev.key.configured') : t('jev.key.required')}</span>
      </div>
      {invalid && <p className={css.jevError} role="alert">{t('jev.key.invalid')}</p>}
    </form>
  )
}
