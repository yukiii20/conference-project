import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-button text-white hover:bg-button-hover active:bg-button-active disabled:opacity-50',
  secondary: 'border border-border bg-surface text-text hover:bg-surface-muted disabled:opacity-50',
  outline: 'border border-button text-button hover:bg-outline-hover disabled:opacity-50',
  danger: 'bg-danger text-white hover:bg-danger-hover disabled:opacity-50',
  ghost: 'text-text hover:bg-text/5 disabled:opacity-50',
  link: 'text-button underline-offset-2 hover:underline disabled:opacity-50',
}

// All sizes keep a >=40px tap target even where padding alone wouldn't (icon-only sm).
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-10 px-3 text-sm gap-1.5',
  md: 'min-h-10 px-4 py-2 text-sm gap-2',
  lg: 'min-h-11 px-5 py-2.5 text-base gap-2',
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
  const isLink = variant === 'link'
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-button ${
        isLink ? '' : 'rounded-md'
      } ${VARIANT_CLASSES[variant]} ${isLink ? '' : SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner size={size === 'lg' ? 'md' : 'sm'} /> : iconLeft}
      {children}
      {!loading ? iconRight : null}
    </button>
  )
})
