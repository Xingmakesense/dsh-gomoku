import type { Context } from '@deepseek-ai/cordis';
import { type GomokuKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The gomoku page copy. */
        gomoku: GomokuKey;
    }
}
/** Required services: the locale registry and the better-sidebar tab registry. */
export declare const inject: string[];
/**
 * Client plugin body: register the gomoku dictionaries and the sidebar
 * page. The registration rides the service's disposer, so plugin unload
 * removes the page.
 * @param ctx - client root context.
 */
export declare function apply(ctx: Context): void;
