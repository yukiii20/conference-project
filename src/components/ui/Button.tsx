import { forwardRef } from 'react'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-button text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(16_28_50/0.12)] hover:bg-button-hover active:bg-button-active disabled:opacity-50 disabled:shadow-none',
  secondary:
    'border border-border bg-surface text-text shadow-[0_1px_2px_rgb(16_28_50/0.05)] hover:border-border-strong hover:bg-page-bg active:bg-surface-muted disabled:opacity-50',
  outline: 'border border-button/60 bg-surface text-button hover:border-button hover:bg-outline-hover active:bg-indigo-soft disabled:opacity-50',
  danger: 'bg-danger text-white shadow-[0_1px_2px_rgb(16_28_50/0.12)] hover:bg-danger-hover disabled:opacity-50',
  ghost: 'text-text hover:bg-surface-muted active:bg-border-soft disabled:opacity-50',
  link: 'text-button underline-offset-4 hover:underline disabled:opacity-50',
}

// All sizes keep a >=40px tap target even where padding alone wouldn't (icon-only sm).
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-10 px-3 text-sm gap-1.5',
  md: 'min-h-10 px-4 py-2 text-sm gap-2',
  lg: 'min-h-11 px-5 py-2.5 text-base gap-2',
}

/**
 * The exact classes <Button> itself applies — exported so a real `<a>`
 * (e.g. an external link that needs to look like a button) can match it
 * without nesting a `<button>` inside an `<a>`, which is invalid HTML and
 * breaks the accessible role Playwright/screen readers see.
 */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className = ''): string {
  const isLink = variant === 'link'
  return `inline-flex select-none items-center justify-center font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-button disabled:cursor-not-allowed ${
    isLink ? '' : 'rounded-lg active:translate-y-px'
  } ${VARIANT_CLASSES[variant]} ${isLink ? '' : SIZE_CLASSES[size]} ${className}`
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

/**
 * Shared button — same action should always use the same variant everywhere:
 * Save/Create/Submit = primary. Cancel/Back = secondary/outline.
 * Delete/Revoke/Reject = danger (pair with ConfirmDialog). Export/Download = outline.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, iconLeft, iconRight, className = '', children, ...rest },
  ref,
) {
  return (
    <button ref={ref} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClasses(variant, size, className)} {...rest}>
      {loading ? <Spinner size={size === 'lg' ? 'md' : 'sm'} /> : iconLeft}
      {children}
      {!loading ? iconRight : null}
    </button>
  )
})

interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

/** Same look as <Button>, but a real `<a>` — for an external/navigational link that should look like a button (e.g. "Public page"). Never nest a <Button> inside an <a>: that's invalid HTML and muddies the accessible role. */
export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  { variant = 'primary', size = 'md', iconLeft, iconRight, className = '', children, ...rest },
  ref,
) {
  return (
    <a ref={ref} className={buttonClasses(variant, size, className)} {...rest}>
      {iconLeft}
      {children}
      {iconRight}
    </a>
  )
})
