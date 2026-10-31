import { describe, expect, it } from 'vitest'
import {
  colourFor,
  formatClock,
  initialTimerState,
  nextTalk,
  parseSavedState,
  pause,
  remainingMs,
  resetPhase,
  start,
  startQa,
  toggle,
  type TimerConfig,
} from './sessionTimer'

/** A fake clock: tests advance it by hand instead of waiting. */
function fakeClock(startAt = 1_000_000) {
  let now = startAt
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

const MIN = 60_000
const config: TimerConfig = { talkMinutes: 15, qaMinutes: 5, talkCount: 3 }

describe('session timer state', () => {
  it('starts paused at the full talk time and does not count down until started', () => {
    const clock = fakeClock()
    const s = initialTimerState()
    clock.advance(10 * MIN)
    expect(remainingMs(s, config, clock.now())).toBe(15 * MIN)
    expect(colourFor(remainingMs(s, config, clock.now()))).toBe('green')
  })

  it('goes green -> amber in the last 2 minutes -> red at time up, then counts overtime', () => {
    const clock = fakeClock()
    let s = start(initialTimerState(), clock.now())
    clock.advance(12 * MIN + 59_000)
    expect(colourFor(remainingMs(s, config, clock.now()))).toBe('green')
    clock.advance(1_000) // exactly 2:00 left
    expect(colourFor(remainingMs(s, config, clock.now()))).toBe('amber')
    clock.advance(2 * MIN) // 0:00
    expect(colourFor(remainingMs(s, config, clock.now()))).toBe('red')
    clock.advance(90_000)
    expect(remainingMs(s, config, clock.now())).toBe(-90_000)
    expect(formatClock(remainingMs(s, config, clock.now()))).toBe('-1:30')
    s = pause(s, clock.now())
    clock.advance(5 * MIN)
    expect(remainingMs(s, config, clock.now())).toBe(-90_000)
  })

  it('pause and resume keep the elapsed time; toggle is space-bar behaviour', () => {
    const clock = fakeClock()
    let s = toggle(initialTimerState(), clock.now())
    clock.advance(3 * MIN)
    s = toggle(s, clock.now()) // pause
    expect(s.running).toBe(false)
    clock.advance(10 * MIN)
    s = toggle(s, clock.now()) // resume
    clock.advance(2 * MIN)
    expect(remainingMs(s, config, clock.now())).toBe(10 * MIN)
    // Starting twice doesn't reset the run.
    expect(start(s, clock.now() + 999)).toBe(s)
  })

  it('Q&A starts its own 5-minute countdown, carrying on running', () => {
    const clock = fakeClock()
    let s = start(initialTimerState(), clock.now())
    clock.advance(16 * MIN)
    s = startQa(s, config, clock.now())
    expect(s.phase).toBe('qa')
    expect(remainingMs(s, config, clock.now())).toBe(5 * MIN)
    clock.advance(4 * MIN)
    expect(colourFor(remainingMs(s, config, clock.now()))).toBe('amber')
    expect(startQa(s, config, clock.now())).toBe(s)
  })

  it('next talk (N) resets to a paused talk phase and stops at the last talk', () => {
    const clock = fakeClock()
    let s = start(initialTimerState(), clock.now())
    clock.advance(7 * MIN)
    s = nextTalk(s, config, clock.now())
    expect(s).toMatchObject({ talkIndex: 1, phase: 'talk', running: false })
    expect(remainingMs(s, config, clock.now())).toBe(15 * MIN)
    s = nextTalk(nextTalk(s, config, clock.now()), config, clock.now())
    expect(s.talkIndex).toBe(2)
  })

  it('with no Q&A time, "Start Q&A" moves straight to the next talk', () => {
    const noQa = { ...config, qaMinutes: 0 }
    const s = startQa(initialTimerState(), noQa, 0)
    expect(s).toMatchObject({ talkIndex: 1, phase: 'talk' })
  })

  it('reset restarts the current phase', () => {
    const clock = fakeClock()
    let s = start(initialTimerState(), clock.now())
    clock.advance(5 * MIN)
    s = resetPhase(s)
    expect(remainingMs(s, config, clock.now())).toBe(15 * MIN)
  })

  it('formats the clock, rounding up while counting down', () => {
    expect(formatClock(15 * MIN)).toBe('15:00')
    expect(formatClock(61_500)).toBe('1:02')
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(-500)).toBe('0:00')
    expect(formatClock(-61_000)).toBe('-1:01')
  })

  it('restores a saved state only when it is valid for this session', () => {
    const saved = JSON.stringify({ talkIndex: 1, phase: 'qa', running: true, elapsedMs: 1000, runningSince: 5 })
    expect(parseSavedState(saved, config)).toMatchObject({ talkIndex: 1, phase: 'qa' })
    expect(parseSavedState(JSON.stringify({ talkIndex: 7, phase: 'talk', running: false, elapsedMs: 0, runningSince: null }), config)).toBeNull()
    expect(parseSavedState('not json', config)).toBeNull()
    expect(parseSavedState(null, config)).toBeNull()
  })
})
