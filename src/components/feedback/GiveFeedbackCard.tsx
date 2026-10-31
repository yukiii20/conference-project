import { Link } from 'react-router-dom'
import { MessageSquareHeart } from 'lucide-react'
import { formatKathmandu } from '../../lib/datetime'
import { Card, buttonClasses } from '../ui'
import { Icon } from '../ui/Icon'
import { useMyFeedback } from './useMyFeedback'

/** Portal dashboard card: shown only while a survey the visitor hasn't answered yet is open. */
export function GiveFeedbackCard({ base }: { base: string }) {
  const { surveys } = useMyFeedback()
  const pending = (surveys ?? []).filter((s) => !s.responded)
  if (pending.length === 0) return null

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <Icon icon={MessageSquareHeart} className="mt-0.5 text-brand/70" />
          <div>
            <h2 className="text-sm font-semibold text-text">Give feedback</h2>
            <p className="text-sm text-text-muted">
              {pending.length === 1
                ? `Tell us how ${pending[0]!.conference_name} went - it takes about two minutes. Closes ${formatKathmandu(pending[0]!.closes_at)}.`
                : `${pending.length} conferences would love your feedback.`}
            </p>
          </div>
        </div>
        <Link to={`${base}/feedback?c=${pending[0]!.conference_id}`} className={buttonClasses('primary', 'sm')}>
          Give feedback
        </Link>
      </div>
    </Card>
  )
}
