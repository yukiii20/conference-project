/**
 * Renders free text as plain text — never raw HTML/dangerouslySetInnerHTML —
 * preserving line breaks and turning bare https:// URLs into links. Safe by
 * construction: every non-link segment is plain React text content.
 */
export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  if (!text) return null
  return (
    <div className={className}>
      {text.split('\n').map((line, i) => (
        <p key={i} className="min-h-[1em]">
          {line.split(/(https:\/\/\S+)/g).map((part, j) =>
            /^https:\/\/\S+$/.test(part) ? (
              <a
                key={j}
                href={part}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-button underline"
              >
                {part}
              </a>
            ) : (
              <span key={j}>{part}</span>
            ),
          )}
        </p>
      ))}
    </div>
  )
}
