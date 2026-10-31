/**
 * Session-chair timer state, kept free of React and of Date.now() so it can
 * be unit-tested with a fake clock: every function takes `now` (ms) and
 * returns a new state.
 *
 * Each talk has two phases: the talk itself, then Q&A. Within a phase the
 * colour is green, amber in the last 2 minutes, and red once time is up -
 * the clock keeps counting into overtime (negative remaining) until the chair
 * moves on.
 */

export const AMBER_THRESHOLD_MS = 2 * 60_000

export type TimerPhase = 'talk' | 'qa'
export type TimerColour = 'green' | 'amber' | 'red'

export type TimerConfig = { talkMinutes: number; qaMinutes: number; talkCount: number }

export type TimerState = {
  talkIndex: number
  phase: TimerPhase
  running: boolean
  /** Time already spent in the current phase before the latest start. */
  elapsedMs: number
  /** Clock reading when the current run started; null while paused. */
  runningSince: number | null
}

export function initialTimerState(): TimerState {
  return { talkIndex: 0, phase: 'talk', running: false, elapsedMs: 0, runningSince: null }
}

export function phaseDurationMs(config: TimerConfig, phase: TimerPhase): number {
  return (phase === 'talk' ? config.talkMinutes : config.qaMinutes) * 60_000
}

export function elapsedMs(state: TimerState, now: number): number {
  return state.elapsedMs + (state.running && state.runningSince !== null ? Math.max(0, now - state.runningSince) : 0)
}

/** Milliseconds left in the current phase; negative = overtime. */
export function remainingMs(state: TimerState, config: TimerConfig, now: number): number {
  return phaseDurationMs(config, state.phase) - elapsedMs(state, now)
}

export function colourFor(remaining: number): TimerColour {
  if (remaining <= 0) return 'red'
  if (remaining <= AMBER_THRESHOLD_MS) return 'amber'
  return 'green'
}

export function start(state: TimerState, now: number): TimerState {
  if (state.running) return state
  return { ...state, running: true, runningSince: now }
}

export function pause(state: TimerState, now: number): TimerState {
  if (!state.running) return state
  return { ...state, running: false, elapsedMs: elapsedMs(state, now), runningSince: null }
}

export function toggle(state: TimerState, now: number): TimerState {
  return state.running ? pause(state, now) : start(state, now)
}

/** Talk -> Q&A for the same talk (keeps running if it was running). A talk with no Q&A time goes straight to the next talk. */
export function startQa(state: TimerState, config: TimerConfig, now: number): TimerState {
  if (state.phase === 'qa') return state
  if (config.qaMinutes === 0) return nextTalk(state, config, now)
  return { ...state, phase: 'qa', elapsedMs: 0, runningSince: state.running ? now : null }
}

/** Moves to the next talk's talk phase, paused and reset - the chair presses Start when the speaker is ready. Stays put on the last talk. */
export function nextTalk(state: TimerState, config: TimerConfig, _now: number): TimerState {
  if (state.talkIndex >= config.talkCount - 1) return { ...state, running: false, runningSince: null, elapsedMs: 0, phase: 'talk' }
  return { talkIndex: state.talkIndex + 1, phase: 'talk', running: false, elapsedMs: 0, runningSince: null }
}

/** Restarts the current phase from zero, paused. */
export function resetPhase(state: TimerState): TimerState {
  return { ...state, running: false, elapsedMs: 0, runningSince: null }
}

/** "12:05" / "-1:30" (overtime) display; seconds are rounded towards the next whole second while counting down. */
export function formatClock(remaining: number): string {
  const negative = remaining < 0
  const totalSeconds = negative ? Math.floor(-remaining / 1000) : Math.ceil(remaining / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${negative && totalSeconds > 0 ? '-' : ''}${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Old saved state must be a structurally valid TimerState, otherwise start fresh. */
export function parseSavedState(raw: string | null, config: TimerConfig): TimerState | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Partial<TimerState>
    if (
      typeof s.talkIndex !== 'number' ||
      s.talkIndex < 0 ||
      s.talkIndex >= Math.max(1, config.talkCount) ||
      (s.phase !== 'talk' && s.phase !== 'qa') ||
      typeof s.running !== 'boolean' ||
      typeof s.elapsedMs !== 'number' ||
      (s.runningSince !== null && typeof s.runningSince !== 'number')
    ) {
      return null
    }
    return s as TimerState
  } catch {
    return null
  }
}
