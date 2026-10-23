import { forwardRef } from 'react'
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

// text-base (16px) everywhere so mobile Safari/Chrome never zoom in on focus.
// Exported so PasswordInput (same field chrome, plus a show/hide button) doesn't duplicate it.
export const FIELD_CLASSES =
  'w-full min-h-10 rounded-md border border-border bg-surface px-3 py-2 text-base text-text placeholder:text-text-muted/60 focus:border-button focus:outline-none disabled:bg-page-bg disabled:text-text-muted'
export const FIELD_ERROR_CLASSES = 'border-danger focus:border-danger'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ error, className = '', ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={error || undefined}
      className={`${FIELD_CLASSES} ${error ? FIELD_ERROR_CLASSES : ''} ${className}`}
      {...rest}
    />
  )
})

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { error, className = '', rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={error || undefined}
      className={`${FIELD_CLASSES} ${error ? FIELD_ERROR_CLASSES : ''} ${className}`}
      {...rest}
    />
  )
})

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { error, className = '', children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={error || undefined}
      className={`${FIELD_CLASSES} ${error ? FIELD_ERROR_CLASSES : ''} ${className}`}
      {...rest}
    >
      {children}
    </select>
  )
})

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, className = '', id, ...rest },
  ref,
) {
  const input = (
    <input
      ref={ref}
      type="checkbox"
      id={id}
      className={`h-5 w-5 flex-shrink-0 rounded border-border text-button focus-visible:outline-2 focus-visible:outline-offset-2 ${className}`}
      {...rest}
    />
  )
  if (!label) return input
  return (
    <label htmlFor={id} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-text">
      {input}
      {label}
    </label>
  )
})
