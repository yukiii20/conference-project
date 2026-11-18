import { Alert } from './ui/Alert'
import { CONFERENCE_ENDED_MESSAGE } from '../lib/conferenceEnded'

/** The notice shown at the top of an ended conference's page and portal (changes-nov2, Part 2). */
export function ConferenceEndedNotice() {
  return (
    <div data-testid="conference-ended-notice">
      <Alert variant="info">{CONFERENCE_ENDED_MESSAGE}</Alert>
    </div>
  )
}
