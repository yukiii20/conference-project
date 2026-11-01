import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'

let fieldIdCounter = 0
function nextFieldId(): string {
  fieldIdCounter += 1
  return `field-${fieldIdCounter}`
}

type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false' }

/**
 * Label + control + help/error text, wired up with the right aria attributes.
 *
 * Pass `htmlFor` when the control already has its own id. Otherwise, when the single child is
 * an element without an id, one is generated and given to it, so the label is always linked
 * (screen readers announce it and clicking it focuses the control) and the help or error text
 * is announced through aria-describedby.
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
  const generatedId = useId()
  const child = isValidElement<ControlProps>(children) ? (children as ReactElement<ControlProps>) : null
  const controlId = htmlFor ?? child?.props.id ?? (child ? `field${generatedId}` : undefined)
  const describedById = controlId && (error || help) ? `${controlId}-desc` : undefined

  const control =
    child && !htmlFor
      ? cloneElement(child, {
          id: controlId,
          'aria-describedby': [child.props['aria-describedby'], describedById].filter(Boolean).join(' ') || undefined,
          ...(error ? { 'aria-invalid': true } : {}),
        })
      : children

  return (
    <div>
      {label ? (
        <label htmlFor={controlId} className="mb-1.5 block text-sm font-medium text-text">
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </label>
      ) : null}
      {control}
      {error ? (
        <p id={describedById} className="mt-1.5 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : help ? (
        <p id={describedById} className="mt-1.5 text-sm text-text-muted">
          {help}
        </p>
      ) : null}
    </div>
  )
}

export { nextFieldId }
