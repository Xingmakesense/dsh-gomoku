import type { GomokuT } from './GomokuView.tsx';
/** Saved keys stay in page memory and never refill the password input. */
export declare function JevKeyEditor({ configured, onSave, t }: {
    configured: boolean;
    onSave: (key: string) => void;
    t: GomokuT;
}): import("react").JSX.Element;
