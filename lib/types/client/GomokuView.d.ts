import type { TabComponentProps } from 'dsh-better-sidebar';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
/** The translate function bound to this plugin's locale namespace. */
export type GomokuT = TranslateNS<'gomoku'>;
/** The board tab's full component props: the sidebar tab seat + the translator. */
export type GomokuViewProps = TabComponentProps & {
    t: GomokuT;
};
/** The tab's + menu icon: a small four-stone grid. */
export declare function GomokuIcon(size?: number): import("react").JSX.Element;
/** The gomoku sidebar tab body. */
export declare function GomokuView({ ctx, t }: GomokuViewProps): import("react").JSX.Element;
