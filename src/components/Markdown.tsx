import { Fragment, useMemo, type ReactNode } from 'react'
import { parseMarkdown, type Inline } from '../lib/markdown'

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={i}>{node.text}</Fragment>
      case 'br':
        return <br key={i} />
      case 'strong':
        return (
          <strong key={i} className="font-semibold">
            {renderInline(node.children)}
          </strong>
        )
      case 'em':
        return <em key={i}>{renderInline(node.children)}</em>
      case 'code':
        return (
          <code key={i} className="rounded bg-surface-muted px-1 py-0.5 font-mono text-[0.9em]">
            {node.text}
          </code>
        )
      case 'link':
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer" className="font-medium text-brand underline underline-offset-2 hover:opacity-80">
            {renderInline(node.children)}
          </a>
        )
    }
  })
}

const HEADING_CLASSES = {
  1: 'font-display text-xl font-semibold tracking-tight',
  2: 'font-display text-lg font-semibold tracking-tight',
  3: 'text-base font-semibold',
} as const

/**
 * Convenor-written Markdown (see src/lib/markdown.ts for the supported
 * subset). Rendered as React elements only — never dangerouslySetInnerHTML —
 * so raw HTML in the source shows as text and links are limited to
 * http(s)/mailto, opening in a new tab with rel="noopener noreferrer".
 */
export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  return (
    <div className={`space-y-3 leading-relaxed ${className}`}>
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          const Tag = (['h3', 'h4', 'h5'] as const)[block.level - 1]!
          return (
            <Tag key={i} className={`${HEADING_CLASSES[block.level]} ${i > 0 ? 'pt-2' : ''}`}>
              {renderInline(block.children)}
            </Tag>
          )
        }
        if (block.type === 'list') {
          const items = block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)
          return block.ordered ? (
            <ol key={i} className="list-decimal space-y-1 pl-6">
              {items}
            </ol>
          ) : (
            <ul key={i} className="list-disc space-y-1 pl-6">
              {items}
            </ul>
          )
        }
        return <p key={i}>{renderInline(block.children)}</p>
      })}
    </div>
  )
}
