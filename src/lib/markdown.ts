// A deliberately small Markdown subset for convenor-written texts (welcome
// text, submission guidelines). It parses into plain data that Markdown.tsx
// turns into React elements, so nothing is ever injected as HTML: a raw
// "<script>" in the text simply shows up as text. Supported: headings (#, ##,
// ###), bullet and numbered lists, paragraphs (single line breaks kept),
// **bold**, *italic* / _italic_, `code`, [links](https://...) and bare
// https:// links. Links only ever point at http(s) or mailto.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'br' }

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }

/** http(s) and mailto only — anything else (javascript:, data:, relative paths) is not a link. */
export function safeHref(raw: string): string | null {
  const href = raw.trim()
  if (/^https?:\/\/[^\s<>"]+$/i.test(href)) return href
  if (/^mailto:[^\s<>"@]+@[^\s<>"]+$/i.test(href)) return href
  return null
}

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      const children: Inline[] = []
      paragraph.forEach((line, i) => {
        if (i > 0) children.push({ type: 'br' })
        children.push(...parseInline(line))
      })
      blocks.push({ type: 'paragraph', children })
      paragraph = []
    }
  }
  const flushList = () => {
    if (list) {
      blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map((item) => parseInline(item)) })
      list = null
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim() === '') {
      flushParagraph()
      flushList()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'heading', level: heading[1]!.length as 1 | 2 | 3, children: parseInline(heading[2]!) })
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = Boolean(numbered)
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1]!)
      continue
    }
    if (list) {
      // An indented line continues the previous list item; anything else ends the list.
      if (/^\s+/.test(rawLine)) {
        list.items[list.items.length - 1] += ` ${line.trim()}`
        continue
      }
      flushList()
    }
    paragraph.push(line.trim())
  }
  flushParagraph()
  flushList()
  return blocks
}

const BARE_URL = /https?:\/\/[^\s<>"]+/y

function trimUrlPunctuation(url: string): string {
  // "see https://x.org." — the trailing full stop/comma/bracket isn't part of the URL.
  return url.replace(/[.,;:!?)\]]+$/, '')
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let buffer = ''
  const flush = () => {
    if (buffer) {
      const last = out[out.length - 1]
      if (last && last.type === 'text') last.text += buffer
      else out.push({ type: 'text', text: buffer })
      buffer = ''
    }
  }

  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)

    if (rest[0] === '\\' && rest.length > 1 && /[\\`*_[\]()#+\-.!]/.test(rest[1]!)) {
      buffer += rest[1]
      i += 2
      continue
    }

    if (rest[0] === '`') {
      const end = rest.indexOf('`', 1)
      if (end > 1) {
        flush()
        out.push({ type: 'code', text: rest.slice(1, end) })
        i += end + 1
        continue
      }
    }

    if (rest.startsWith('**')) {
      const end = rest.indexOf('**', 2)
      if (end > 2) {
        flush()
        out.push({ type: 'strong', children: parseInline(rest.slice(2, end)) })
        i += end + 2
        continue
      }
    }

    if ((rest[0] === '*' || rest[0] === '_') && rest[1] && rest[1] !== ' ' && rest[1] !== rest[0]) {
      const marker = rest[0]
      const end = rest.indexOf(marker, 1)
      // `_` only counts at a word boundary, so snake_case_words stay as text.
      const before = text[i - 1]
      const after = rest[end + 1]
      const boundaryOk = marker === '*' || ((!before || !/\w/.test(before)) && (!after || !/\w/.test(after)))
      if (end > 1 && rest[end - 1] !== ' ' && boundaryOk) {
        flush()
        out.push({ type: 'em', children: parseInline(rest.slice(1, end)) })
        i += end + 1
        continue
      }
    }

    if (rest[0] === '[') {
      const match = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest)
      if (match) {
        const href = safeHref(match[2]!)
        flush()
        if (href) out.push({ type: 'link', href, children: parseInline(match[1]!) })
        else out.push(...parseInline(match[1]!)) // unsafe target: keep the words, drop the link
        i += match[0].length
        continue
      }
    }

    if (rest[0] === 'h' && (!text[i - 1] || /[\s(]/.test(text[i - 1]!))) {
      BARE_URL.lastIndex = 0
      const match = BARE_URL.exec(rest)
      if (match) {
        const url = trimUrlPunctuation(match[0])
        const href = safeHref(url)
        if (href) {
          flush()
          out.push({ type: 'link', href, children: [{ type: 'text', text: url }] })
          i += url.length
          continue
        }
      }
    }

    buffer += rest[0]
    i += 1
  }
  flush()
  return out
}
