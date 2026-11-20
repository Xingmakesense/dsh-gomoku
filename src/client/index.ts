/**
 * Gomoku browser half, plugin entry: registers the gomoku dictionaries and
 * the gomoku page on the Better Sidebar service. The board state lives in
 * the module-level store, so tab switches never reset the game.
 *
 * Better Sidebar is a hard client requirement: the page exists only inside
 * its registry, so the plugin waits for `ctx.betterSidebar` before applying.
 * @module @yejiming/dsh-gomoku/client
 */
import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.betterSidebar service merge and TabDescriptor.
import type {} from 'dsh-better-sidebar'
import { GomokuIcon, GomokuView } from './GomokuView.tsx'
import { NS, en, zh, type GomokuKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The gomoku page copy. */
    gomoku: GomokuKey
  }
}

/** Required services: the locale registry and the better-sidebar tab registry. */
export const inject = ['locale', 'betterSidebar']

/**
 * Client plugin body: register the gomoku dictionaries and the sidebar
 * page. The registration rides the service's disposer, so plugin unload
 * removes the page.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'gomoku: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.betterSidebar.registerTab({
    id: 'gomoku',
    title: () => t('tab.label'),
    description: () => t('tab.description'),
    icon: size => GomokuIcon(size),
    order: 200,
    // One board per session: re-opening focuses the existing page.
    single: true,
    component: props => createElement(GomokuView, { ...props, t }),
  }), 'gomoku: better-sidebar page')
}