import { describe, expect, it } from 'vitest'
import { htmlToText } from '../src/email/layout.js'

describe('htmlToText', () => {
  it('keeps the link target next to its label', () => {
    const text = htmlToText('<p>Hello</p><p><a href="https://example.com/invitations/accept?token=abc&amp;x=1" style="color:#fff">View and accept</a></p>')
    expect(text).toContain('View and accept (https://example.com/invitations/accept?token=abc&x=1)')
  })

  it('does not repeat a link whose label is the URL itself', () => {
    expect(htmlToText('<a href="https://example.com/reset">https://example.com/reset</a>')).toBe('https://example.com/reset')
  })

  it('still strips other markup', () => {
    expect(htmlToText('<div><strong>Bold</strong> text<br>next</div>')).toBe('Bold text\nnext')
  })
})
