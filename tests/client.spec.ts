import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

interface RegisteredTab {
  id: string
  title: () => string
  description: () => string
  icon: (size: number) => unknown
  order: number
  single: boolean
  component: (props: unknown) => unknown
}

interface SlotRegistration {
  name: string
  options: Record<string, unknown>
  component: unknown
}

/** A fake client context: only the services the plugin entry touches. */
function fakeContext(): {
  ctx: unknown
  tabs: RegisteredTab[]
  slots: SlotRegistration[]
  waits: string[]
  effects: () => number
} {
  const tabs: RegisteredTab[] = []
  const slots: SlotRegistration[] = []
  const waits: string[] = []
  let effects = 0
  const locale = {
    register: () => () => {},
    bind: () => (key: string) => key,
  }
  const ctx = {
    locale,
    slots: {
      inject(key: string, callback: () => () => void) {
        waits.push(key)
        callback()
        return () => {}
      },
      register(options: Record<string, unknown>, component: unknown) {
        slots.push({ name: String(options.name), options, component })
        return () => {}
      },
    },
    betterSidebar: {
      registerTab(descriptor: RegisteredTab) {
        tabs.push(descriptor)
        return () => {}
      },
    },
    effect(run: () => unknown) {
      effects += 1
      run()
    },
  }
  return { ctx, tabs, slots, waits, effects: () => effects }
}

describe('gomoku client entry', () => {
  it('waits for the locale, slot and Better Sidebar services', () => {
    expect(inject).toEqual(['locale', 'slots', 'betterSidebar'])
  })

  it('registers the settings section plus its navigation icon', () => {
    const { ctx, slots, waits } = fakeContext()
    apply(ctx as never)
    expect(waits).toEqual(['settings.section', 'settings.section.icon'])
    expect(slots.map(entry => entry.name)).toEqual(['settings.section', 'settings.section.icon'])
    const section = slots[0]!
    expect(section.options.id).toBe('gomoku')
    expect(section.options.order).toBe(140)
    // Unknown keys stay verbatim through the fake translator.
    expect((section.options.label as () => string)()).toBe('settings.label')
    expect(typeof section.component).toBe('function')
    expect(typeof slots[1]!.component).toBe('function')
  })

  it('registers one single-instance board page', () => {
    const { ctx, tabs, effects } = fakeContext()
    apply(ctx as never)
    // Dictionaries + the board page ride ctx.effect; the two slot
    // registrations ride the slot service's declaration inject.
    expect(effects()).toBe(2)
    expect(tabs).toHaveLength(1)
    const tab = tabs[0]!
    expect(tab.id).toBe('gomoku')
    expect(tab.order).toBe(200)
    expect(tab.single).toBe(true)
    expect(tab.title()).toBe('tab.label')
    expect(tab.description()).toBe('tab.description')
    expect(tab.icon(16)).toBeTruthy()
    expect(typeof tab.component).toBe('function')
  })
})
