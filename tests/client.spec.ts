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

/** A fake client context: only the services the plugin entry touches. */
function fakeContext(): { ctx: unknown; registered: RegisteredTab[]; effects: number } {
  const registered: RegisteredTab[] = []
  let effects = 0
  const locale = {
    register: () => () => {},
    bind: () => (key: string) => key,
  }
  const ctx = {
    locale,
    betterSidebar: {
      registerTab(descriptor: RegisteredTab) {
        registered.push(descriptor)
        return () => {}
      },
    },
    effect(run: () => unknown) {
      effects += 1
      run()
    },
  }
  return { ctx, registered, effects: () => effects }
}

describe('gomoku client entry', () => {
  it('waits for the locale and Better Sidebar services', () => {
    expect(inject).toEqual(['locale', 'betterSidebar'])
  })

  it('registers one single-instance gomoku page', () => {
    const { ctx, registered, effects } = fakeContext()
    apply(ctx as never)
    expect(effects()).toBe(2)
    expect(registered).toHaveLength(1)
    const tab = registered[0]!
    expect(tab.id).toBe('gomoku')
    expect(tab.order).toBe(200)
    expect(tab.single).toBe(true)
    // Unknown keys stay verbatim through the fake translator.
    expect(tab.title()).toBe('tab.label')
    expect(tab.description()).toBe('tab.description')
    expect(tab.icon(16)).toBeTruthy()
    expect(typeof tab.component).toBe('function')
  })
})
