import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FormField } from './FormField'
import { Input } from './Input'

function render(props: Parameters<typeof FormField>[0]): string {
  return renderToStaticMarkup(createElement(FormField, props))
}

describe('FormField', () => {
  it('links its label to a child control that has no id of its own', () => {
    const html = render({ label: 'Opens', children: createElement(Input, { type: 'datetime-local' }) })
    const labelFor = html.match(/<label for="([^"]+)"/)?.[1]
    const inputId = html.match(/<input[^>]* id="([^"]+)"/)?.[1]
    expect(labelFor).toBeTruthy()
    expect(labelFor).toBe(inputId)
  })

  it('keeps an id the control already has', () => {
    const html = render({ label: 'Email', children: createElement(Input, { id: 'si-email' }) })
    expect(html).toContain('<label for="si-email"')
    expect(html).toContain('id="si-email"')
  })

  it('respects htmlFor and leaves the child untouched', () => {
    const html = render({ label: 'Name', htmlFor: 'custom', children: createElement('div', null, createElement('input', { id: 'custom' })) })
    expect(html).toContain('<label for="custom"')
    expect(html.match(/id="custom"/g)).toHaveLength(1)
  })

  it('announces help and error text through aria-describedby', () => {
    const help = render({ label: 'Phone', help: 'With country code', children: createElement(Input, {}) })
    const helpId = help.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(help).toContain(`<p id="${helpId}"`)

    const error = render({ label: 'Phone', error: 'Required', children: createElement(Input, {}) })
    expect(error).toContain('aria-invalid="true"')
    expect(error).toMatch(/<p id="[^"]+-desc"[^>]*role="alert"/)
  })
})
