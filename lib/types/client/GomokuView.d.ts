import type { TabComponentProps } from 'dsh-better-sidebar';
import { type GomokuT } from './i18n.ts';
/** The board page's full component props: the sidebar tab seat + the translator. */
export type GomokuViewProps = TabComponentProps & {
    t: GomokuT;
};
/** The tab's + menu and settings-nav icon: a small four-stone grid. */
export declare function gomokuIcon(size?: number): import("react").JSX.Element;
/** The gomoku sidebar page body: board + game-start controls. */
export declare function GomokuView({ ctx, t }: GomokuViewProps): import("react").JSX.Element;
