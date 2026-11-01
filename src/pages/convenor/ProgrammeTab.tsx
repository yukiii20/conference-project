import { useState } from 'react'
import { TimerDefaultsSection } from './SessionTimerSettings'
import { RoomsSection } from './programme/RoomsSection'
import { TimeSlotsSection } from './programme/TimeSlotsSection'
import { SessionsSection } from './programme/SessionsSection'

export function ProgrammeTab({ conferenceId }: { conferenceId: string }) {
  const [roomsVersion, setRoomsVersion] = useState(0)
  const [slotsVersion, setSlotsVersion] = useState(0)
  return (
    <div className="mt-6 max-w-6xl">
      <RoomsSection conferenceId={conferenceId} onRoomsChanged={() => setRoomsVersion((v) => v + 1)} />
      <TimeSlotsSection conferenceId={conferenceId} onSlotsChanged={() => setSlotsVersion((v) => v + 1)} />
      <SessionsSection conferenceId={conferenceId} roomsVersion={roomsVersion} slotsVersion={slotsVersion} />
      <TimerDefaultsSection conferenceId={conferenceId} />
    </div>
  )
}
