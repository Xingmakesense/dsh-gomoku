import { type DropdownGroup } from './dropdown-logic.ts';
import type { ColorScheme } from './theme.ts';
/** Props of one dropdown: the label above it plus the option groups. */
export interface DropdownProps {
    /** Field label, rendered above the trigger and used as its accessible name. */
    label: string;
    /** Currently selected wire value ('' when nothing is selected yet). */
    value: string;
    /** Selectable groups, in catalog order. */
    groups: readonly DropdownGroup[];
    /** Trigger text while nothing is selected. */
    placeholder: string;
    /** Text shown when the list has no options at all. */
    emptyText: string;
    /** Called with the chosen value; the menu closes first. */
    onChange: (value: string) => void;
    /** Renders the trigger inert (e.g. the catalog is still loading). */
    disabled?: boolean;
    /** The appearance the portaled menu paints itself in. */
    scheme?: ColorScheme;
}
/** The model picker: a token-themed listbox. */
export declare function Dropdown({ label, value, groups, placeholder, emptyText, onChange, disabled, scheme, }: DropdownProps): import("react").JSX.Element;
