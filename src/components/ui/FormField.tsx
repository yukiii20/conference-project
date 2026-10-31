import type { ReactNode } from 'react'

let fieldIdCounter = 0
function nextFieldId(): string {
  fieldIdCounter += 1
  return `field-${fieldIdCounter}`
}

/**
 * Label + control + help/error text, wired up with the right aria attributes.
 * Pass `id` through to the control via the render prop so label/error stay linked.
 */
export function FormField({
  label,
  help,
  error,
  required,
  htmlFor,
  children,
}: {
  label?: string
  help?: string
  error?: string
  required?: boolean
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div>
      {label ? (
        <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-text">
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1.5 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : help ? (
        <p className="mt-1.5 text-sm text-text-muted">{help}</p>
      ) : null}
    </div>
  )
}

export { nextFieldId }
