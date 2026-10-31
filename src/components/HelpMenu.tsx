import { useState } from 'react'
import { CircleHelp, FileText, Keyboard, Mail, Shield } from 'lucide-react'
import { SITE } from '../content/site'
import { DropdownMenu } from './ui/Menu'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['Ctrl', 'K'], label: 'Search pages and sections (⌘ K on Mac)' },
  { keys: ['/'], label: 'Search pages and sections' },
  { keys: ['['], label: 'Collapse or expand the sidebar' },
  { keys: ['Esc'], label: 'Close a dialog, menu or panel' },
  { keys: ['↑', '↓'], label: 'Move through menus and search results' },
]

/** Top-bar help: keyboard shortcuts, contact, legal pages. Every entry does something real. */
export function HelpMenu() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  return (
    <>
      <DropdownMenu
        label="Help"
        width="w-64"
        items={[
          { label: 'Keyboard shortcuts', icon: <Keyboard />, onSelect: () => setShortcutsOpen(true) },
          { label: 'Contact support', icon: <Mail />, href: SITE.contactGmailHref, hint: 'Email' },
          { type: 'separator' },
          { label: 'Privacy policy', icon: <Shield />, to: '/privacy' },
          { label: 'Terms of use', icon: <FileText />, to: '/terms' },
        ]}
        trigger={({ open, ...props }) => (
          <button
            {...props}
            aria-label="Help"
            className={`flex h-10 w-10 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-muted hover:text-text ${
              open ? 'bg-surface-muted text-text' : ''
            }`}
          >
            <CircleHelp size={19} aria-hidden="true" />
          </button>
        )}
      />
      <Modal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="Keyboard shortcuts"
        description="Available anywhere in the signed-in workspace, except while typing in a field."
        footer={
          <Button variant="secondary" onClick={() => setShortcutsOpen(false)}>
            Close
          </Button>
        }
      >
        <dl className="mt-4 divide-y divide-border-soft">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <dt className="text-text">{s.label}</dt>
              <dd className="flex shrink-0 gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="min-w-7 rounded border border-border bg-page-bg px-1.5 py-0.5 text-center font-sans text-xs text-text">
                    {k}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </Modal>
    </>
  )
}
