/**
 * "Ended" state of a conference (changes-nov2, Part 2) - the UI copy of
 * server/src/utils/conferenceEnded.ts. A conference has ended once its end date is over in
 * Nepal time (from 00:00 Asia/Kathmandu on the next day). The server is authoritative: it
 * refuses the blocked actions with code 'conference_ended'; the UI only hides the buttons.
 */

export const CONFERENCE_ENDED_MESSAGE = 'This conference has ended. Conference activity is closed.'

/** Nepal is UTC+05:45 all year (no daylight saving). */
const NEPAL_OFFSET_MINUTES = 5 * 60 + 45

/** The first instant after `endDate` ('YYYY-MM-DD') in Nepal time. */
export function conferenceEndsAt(endDate: string): Date {
  const [y, m, d] = endDate.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + 1, 0, 0, 0) - NEPAL_OFFSET_MINUTES * 60_000)
}

export function isConferenceEnded(endDate: string | null | undefined, now: Date = new Date()): boolean {
  if (!endDate) return false
  return now.getTime() >= conferenceEndsAt(endDate).getTime()
}
