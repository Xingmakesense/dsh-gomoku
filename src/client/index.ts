/**
 * Gomoku browser half, plugin entry. Contributes three client pieces:
 *
 * - the gomoku dictionaries;
 * - the Settings → Gomoku page (models, thinking levels, prompts, Jev key
 *   and the reasoning log);
 * - the board page on the Better Sidebar service (board + game-start
 *   controls only).
 *
 * The board state lives in the module-level store, so tab switches never
 * reset the game. Better Sidebar is a hard client requirement: the board
 * page exists only inside its registry, so the plugin waits for
 * `ctx.betterSidebar` before applying.
 * @module @yejiming/dsh-gomoku/client
 */
import { createElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: declares the settings slots this plugin contributes to.
import type { SettingsSectionIconOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ctx.betterSidebar service merge and TabDescriptor.
import type {} from 'dsh-better-sidebar'
import { gomokuIcon, GomokuView } from './GomokuView.tsx'
import { GomokuSettings } from './GomokuSettings.tsx'
import { NS, en, zh, type GomokuKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The gomoku page and settings copy. */
    gomoku: GomokuKey
  }
}

/** Required services: locale, the slot registry and the sidebar tab registry. */
export const inject = ['locale', 'slots', 'betterSidebar']

/**
 * Client plugin body: register the dictionaries, the settings page and the
 * board page. Every registration rides its service's disposer, so plugin
 * unload removes all three.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'gomoku: dictionaries')
  const t = ctx.locale.bind(NS)

  // Settings → Gomoku: per-side model, thinking level and prompt, the
  // shared Jev key and the current game's reasoning log.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'gomoku',
    order: 140,
    label: () => t('settings.label'),
    locale: NS,
  }, GomokuSettings))

  // The nav icon addressed by the section id above.
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon',
    id: 'gomoku',
    order: 140,
  }, ({ size }: SettingsSectionIconOwnerProps) => gomokuIcon(size)))

  ctx.effect(() => ctx.betterSidebar.registerTab({
    id: 'gomoku',
    title: () => t('tab.label'),
    description: () => t('tab.description'),
    icon: size => gomokuIcon(size),
    order: 200,
    // One board per session: re-opening focuses the existing page.
    single: true,
    component: props => createElement(GomokuView, { ...props, t }),
  }), 'gomoku: better-sidebar page')
}