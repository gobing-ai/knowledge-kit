/**
 * Types for the host's module UI kit facade, `@gobing-ai/spur/board/ui` (ADR-150).
 *
 * `@gobing-ai/spur` is a declaration-only authoring dependency: this repo consumes the kit at
 * RUNTIME through the Board's document import map (`web/board-runtime.json`), and the host page
 * already ships the stylesheet the kit's classes need — so the package itself is not installed
 * here. These declarations mirror the published surface emitted from the Spur sources
 * (`apps/web/src/components/module-kit/`, emitted to `apps/cli/board/kit/`); they are types only.
 * A kit prop change that breaks this file must bump the host's `uiKitVersion`.
 */

declare module '@gobing-ai/spur/board/ui' {
    import type { ButtonHTMLAttributes, HTMLAttributes, JSX, ReactNode } from 'react';

    /** Page container for a Board module: the centered rail and dense module padding (ADR-081). */
    export interface ModuleShellProps extends HTMLAttributes<HTMLDivElement> {
        children: ReactNode;
        /** Appended layout classes (e.g. `max-w-none` for the full-bleed exception). */
        className?: string;
    }
    export declare function ModuleShell(props: ModuleShellProps): JSX.Element;

    /** Slots of the one-row module header (identity left, filters middle, tab strip right). */
    export interface ModuleHeaderProps {
        /** Identity icon for the module. */
        icon: ReactNode;
        /** Module title — the route's only `h1`. */
        title: string;
        /** Optional one-line purpose under the title. */
        subtitle?: ReactNode;
        /** Optional status chip (a `role="status"` element owned by the module). */
        status?: ReactNode;
        /** Inline filters and range presets, centred between identity and tabs. */
        filters?: ReactNode;
        /** The tab strip, rendered right-aligned. */
        tabs?: ReactNode;
        className?: string;
    }
    export declare function ModuleHeader(props: ModuleHeaderProps): JSX.Element;

    /** One tab in a module's append-only strip; `id` is the identity persisted state keys on. */
    export interface ModuleTab {
        readonly id: string;
        readonly label: string;
    }

    /** Controlled tab strip over an append-only tab list (`role="tablist"` of `role="tab"` buttons). */
    export interface ModuleTabsProps {
        /** The module's tabs, in contract order — never reordered at render time. */
        tabs: readonly ModuleTab[];
        /** Id of the selected tab. */
        value: string;
        /** Called with the clicked tab id; the caller owns the state. */
        onChange: (id: string) => void;
        /** Accessible name of the `tablist`. */
        label: string;
        /** Id prefix: a button is `${idPrefix}-${tab.id}` and controls `${idPrefix}-panel-${tab.id}`. */
        idPrefix: string;
        className?: string;
    }
    export declare function ModuleTabs(props: ModuleTabsProps): JSX.Element;

    /** The standard module empty state: muted, italic, centred, no placeholder rows. */
    export interface EmptyStateProps {
        children: ReactNode;
        testId?: string;
    }
    export declare function EmptyState(props: EmptyStateProps): JSX.Element;

    /** Severity of the diagnostic surface; both tones use the same neutral container. */
    export type DiagnosticTone = 'error' | 'warning';

    /** An actionable failure rendered inside the module region: what failed, why, what next. */
    export interface DiagnosticProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
        title: ReactNode;
        detail?: ReactNode;
        /** Machine-readable anchor (category, specifier, failing value) in mono type. */
        code?: ReactNode;
        hint?: ReactNode;
        testId?: string;
        tone?: DiagnosticTone;
    }
    export declare function Diagnostic(props: DiagnosticProps): JSX.Element;

    /** daisyUI badge colour names accepted by the host `ui` seam. */
    export type BadgeVariant =
        | 'neutral'
        | 'primary'
        | 'secondary'
        | 'accent'
        | 'ghost'
        | 'info'
        | 'success'
        | 'warning'
        | 'error'
        | 'outline';
    /** daisyUI badge size scale accepted by the host `ui` seam. */
    export type BadgeSize = 'xs' | 'sm' | 'md' | 'lg';

    /** daisyUI `badge` wrapper (host `ui` seam, re-exported unchanged). */
    export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
        children?: ReactNode;
        variant?: BadgeVariant;
        size?: BadgeSize;
    }
    export declare function Badge(props: BadgeProps): JSX.Element;

    /** daisyUI button colour names accepted by the host `ui` seam. */
    export type ButtonVariant = 'primary' | 'ghost' | 'error' | 'outline' | 'accent' | 'warning';
    /** daisyUI button size scale accepted by the host `ui` seam. */
    export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

    /** daisyUI `btn` wrapper (host `ui` seam, re-exported unchanged). */
    export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
        children?: ReactNode;
        variant?: ButtonVariant;
        size?: ButtonSize;
        loading?: boolean;
        asChild?: boolean;
    }
    export declare function Button(props: ButtonProps): JSX.Element;

    /** daisyUI `card` wrapper (host `ui` seam, re-exported unchanged). */
    export interface CardProps extends HTMLAttributes<HTMLDivElement> {
        children?: ReactNode;
        variant?:
            | 'bordered'
            | 'primary'
            | 'secondary'
            | 'accent'
            | 'neutral'
            | 'imagefull'
            | 'compact'
            | 'normal'
            | 'side';
        asChild?: boolean;
    }
    export declare function Card(props: CardProps): JSX.Element;

    /** Body of a {@link Card}. */
    export interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
        children?: ReactNode;
    }
    export declare function CardBody(props: CardBodyProps): JSX.Element;

    /** daisyUI spinner pinned to the kit's contract. */
    export interface LoadingProps extends HTMLAttributes<HTMLSpanElement> {
        size?: 'xs' | 'sm' | 'md' | 'lg';
    }
    export declare function Loading(props: LoadingProps): JSX.Element;

    /**
     * Base-path helpers (ADR-151 §5): a module builds URLs with these instead of `'/api'` /
     * `'/board/…'` literals so the same build works under a gateway prefix and at the root.
     */
    export declare function basePath(): string;
    export declare function withBase(path: string): string;
    export declare function resolveApiUrl(path: string): string;
}
