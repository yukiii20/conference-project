import { forwardRef, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { FIELD_CLASSES, FIELD_ERROR_CLASSES } from './Input'
import { Icon } from './Icon'

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  error?: boolean
}

/**
 * Password field with a built-in show/hide toggle (Eye/EyeOff) inside the
 * field - the one shared place every password form (login, signup, set/reset
 * password, change password) gets this from, instead of each page wiring up
 * its own `showPassword` state and a separate "Show"/"Hide" button.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { error, className = '', ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? 'text' : 'password'}
        aria-invalid={error || undefined}
        className={`${FIELD_CLASSES} pr-10 ${error ? FIELD_ERROR_CLASSES : ''} ${className}`}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-button"
      >
        <Icon icon={visible ? EyeOff : Eye} size={18} />
      </button>
    </div>
  )
})
