import type { Context } from '@deepseek-ai/cordis';
import { type GomokuKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The gomoku page and settings copy. */
        gomoku: GomokuKey;
    }
}
/** Required services: locale, the slot registry and the sidebar tab registry. */
export declare const inject: string[];
/**
 * Client plugin body: register the dictionaries, the settings page and the
 * board page. Every registration rides its service's disposer, so plugin
 * unload removes all three.
 * @param ctx - client root context.
 */
export declare function apply(ctx: Context): void;
