import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
/** Props of the settings page: the locale seat plus the settings shell's close. */
export type GomokuSettingsProps = PropsLocale<'gomoku'> & {
    close: () => void;
};
/** The settings page body. */
export declare function GomokuSettings({ t }: GomokuSettingsProps): import("react").JSX.Element;
