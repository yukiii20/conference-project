import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-button text-white hover:opacity-90 disabled:opacity-50',
  secondary: 'border border-line bg-white text-ink hover:bg-background disabled:opacity-50',
  outline: 'border border-button text-button hover:bg-button/5 disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-50',
  ghost: 'text-ink hover:bg-ink/5 disabled:opacity-50',
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
      className={`inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
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
