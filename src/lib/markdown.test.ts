import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, safeHref } from './markdown'

describe('safeHref', () => {
  it('allows http(s) and mailto only', () => {
    expect(safeHref('https://example.org/a?b=1')).toBe('https://example.org/a?b=1')
    expect(safeHref('http://example.org')).toBe('http://example.org')
    expect(safeHref('mailto:info@example.org')).toBe('mailto:info@example.org')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,<b>x</b>')).toBeNull()
    expect(safeHref('/relative')).toBeNull()
    expect(safeHref('https://x.org/"onmouseover="a')).toBeNull()
  })
})

describe('parseMarkdown', () => {
  it('parses headings, lists and paragraphs, keeping single line breaks', () => {
    const blocks = parseMarkdown('# Title\n\nFirst line\nsecond line\n\n- one\n- two\n\n1. a\n2. b')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list'])
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, children: [{ type: 'text', text: 'Title' }] })
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: 'First line' }, { type: 'br' }, { type: 'text', text: 'second line' }],
    })
    expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ text: 'one' }], [{ text: 'two' }]] })
    expect(blocks[3]).toMatchObject({ ordered: true, items: [[{ text: 'a' }], [{ text: 'b' }]] })
  })

  it('splits a bullet list from a numbered list that follows it directly', () => {
    const blocks = parseMarkdown('- a\n1. b')
    expect(blocks).toHaveLength(2)
  })

  it('treats raw HTML as plain text', () => {
    const blocks = parseMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '<script>alert(1)</script> <img src=x onerror=alert(1)>' }] },
    ])
  })
})

describe('parseInline', () => {
  it('parses bold, italic and code', () => {
    expect(parseInline('a **b** *c* `d`')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
    ])
  })

  it('leaves snake_case words and lone asterisks alone', () => {
    expect(parseInline('max_file_size and 2 * 3')).toEqual([{ type: 'text', text: 'max_file_size and 2 * 3' }])
  })

  it('makes safe links, drops unsafe ones but keeps their words', () => {
    expect(parseInline('[Template](https://x.org/t.docx)')).toEqual([
      { type: 'link', href: 'https://x.org/t.docx', children: [{ type: 'text', text: 'Template' }] },
    ])
    const unsafe = parseInline('[click](javascript:alert(1))')
    expect(unsafe.some((n) => n.type === 'link')).toBe(false)
    expect(unsafe).toEqual([{ type: 'text', text: 'click)' }])
  })

  it('autolinks bare URLs without the trailing full stop', () => {
    expect(parseInline('See https://x.org/guide.')).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'link', href: 'https://x.org/guide', children: [{ type: 'text', text: 'https://x.org/guide' }] },
      { type: 'text', text: '.' },
    ])
  })

  it('honours backslash escapes', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([{ type: 'text', text: '*not italic*' }])
  })
})
