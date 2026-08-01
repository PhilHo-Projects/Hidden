import { createGame, type MatchRules, type Seat } from '@hidden/game-core'
import { describe, expect, it, vi } from 'vitest'
import {
  createMatchRoom,
  MatchCoordinator,
  type MatchCoordinatorDependencies,
  type RoomFactoryInput,
} from './matchCoordinator'

const firstParticipant = {
  accountId: 'account-uuid-one',
  connectionId: 11,
  username: 'Account_One',
}
const secondParticipant = {
  connectionId: 22,
  username: 'Guest#0022',
}

function deterministicDependencies(overrides: {
  firstSeats?: Seat[]
  now?: number
  onDeadline?: MatchCoordinatorDependencies['onDeadline']
  roomFactory?: MatchCoordinatorDependencies['roomFactory']
  seeds?: number[]
  uuids?: string[]
} = {}) {
  const uuids = [...(overrides.uuids ?? ['room-uuid', 'run-uuid'])]
  const seeds = [...(overrides.seeds ?? [7])]
  const firstSeats = [...(overrides.firstSeats ?? [0])]
  const scheduled: Array<{ callback: () => void; delayMs: number; handle: object }> = []
  const clearTimeout = vi.fn<(handle: unknown) => void>()
  const dependencies: MatchCoordinatorDependencies = {
    createUuid: () => uuids.shift() ?? 'unexpected-uuid',
    createSeed: () => seeds.shift() ?? 0,
    chooseFirstSeat: () => firstSeats.shift() ?? 0,
    now: () => overrides.now ?? 1_000,
    scheduleTimeout: (callback, delayMs) => {
      const handle = { index: scheduled.length }
      scheduled.push({ callback, delayMs, handle })
      return handle
    },
    clearTimeout,
    ...(overrides.onDeadline ? { onDeadline: overrides.onDeadline } : {}),
    ...(overrides.roomFactory ? { roomFactory: overrides.roomFactory } : {}),
  }
  return { clearTimeout, dependencies, scheduled }
}

describe('MatchCoordinator discovery and trusted rooms', () => {
  it('discovers two eligible participants through the reusable room factory with frozen trusted seats and rules', () => {
    const roomFactory = vi.fn((input: RoomFactoryInput) => createMatchRoom(input))
    const { dependencies } = deterministicDependencies({
      roomFactory,
      uuids: ['stable-room-id'],
    })
    const coordinator = new MatchCoordinator(dependencies)
    const mutableFirst = { ...firstParticipant }
    const proposedRules = {
      rounds: 999,
      turnSeconds: 0,
      blindMode: false,
    } satisfies MatchRules

    expect(coordinator.enqueueQuickMatch(mutableFirst, proposedRules)).toBeUndefined()
    const room = coordinator.enqueueQuickMatch(secondParticipant)

    expect(roomFactory).toHaveBeenCalledOnce()
    expect(roomFactory).toHaveBeenCalledWith({
      id: 'stable-room-id',
      participants: [
        { ...firstParticipant, seat: 0 },
        { accountId: undefined, ...secondParticipant, seat: 1 },
      ],
      rules: { rounds: 20, turnSeconds: 2, blindMode: false },
    })
    expect(room?.id).toBe('stable-room-id')
    expect(coordinator.getRoomForConnection(11)).toBe(room)
    expect(coordinator.getRoomForConnection(22)).toBe(room)
    expect(room?.phase).toBe('ready')
    expect(room?.participants.map(({ connectionId, seat }) => ({ connectionId, seat }))).toEqual([
      { connectionId: 11, seat: 0 },
      { connectionId: 22, seat: 1 },
    ])
    expect(room?.participants[0]?.accountId).toBe('account-uuid-one')
    expect(room?.participants[1]?.accountId).toBeUndefined()
    expect(Object.isFrozen(room?.participants)).toBe(true)
    expect(Object.isFrozen(room?.participants[0])).toBe(true)
    expect(Object.isFrozen(room?.rules)).toBe(true)

    mutableFirst.accountId = 'mutated-account'
    mutableFirst.username = 'Mutated_Name'
    proposedRules.rounds = 1
    expect(room?.participants[0]).toMatchObject(firstParticipant)
    expect(room?.rules).toEqual({ rounds: 20, turnSeconds: 2, blindMode: false })
  })
})

describe('MatchCoordinator run lifecycle', () => {
  it('tracks ready and unready transitions and freezes one deterministic canonical start only when both seats are ready', () => {
    const { dependencies, scheduled } = deterministicDependencies({
      firstSeats: [1],
      seeds: [0x1_0000_0005],
      uuids: ['stable-room-id', 'run-uuid-one'],
    })
    const coordinator = new MatchCoordinator(dependencies)
    const room = coordinator.enqueueQuickMatch(firstParticipant, {
      rounds: 8,
      turnSeconds: 15,
      blindMode: false,
    })
    expect(room).toBeUndefined()
    const pairedRoom = coordinator.enqueueQuickMatch(secondParticipant)!

    expect(coordinator.setReady(11, true).start).toBeUndefined()
    expect(coordinator.setReady(11, false)).toMatchObject({ ready: false })
    expect(coordinator.setReady(22, true).start).toBeUndefined()
    const result = coordinator.setReady(11, true)
    const start = result.start!

    expect(start.firstConnectionId).toBe(22)
    expect(start.run.id).toBe('run-uuid-one')
    expect(start.run.phase).toBe('active')
    expect(start.run.revision).toBe(0)
    expect(start.run.deadline).toBe(16_000)
    expect(start.run.spec).toEqual({
      mode: { id: 'classic', revision: 1 },
      rules: { rounds: 8, turnSeconds: 15, blindMode: false },
      seed: 5,
      firstSeat: 1,
    })
    expect(start.run.spec.rules).toBe(pairedRoom.rules)
    expect(Object.isFrozen(start.run.spec)).toBe(true)
    expect(Object.isFrozen(start.run.spec.mode)).toBe(true)
    expect(Object.isFrozen(start.run.spec.rules)).toBe(true)
    expect(start.run.state).toEqual(createGame(start.run.spec))
    expect(start.descriptor).toEqual({
      matchId: 'run-uuid-one',
      mode: { id: 'classic', revision: 1 },
      rules: { rounds: 8, turnSeconds: 15, blindMode: false },
      seed: 5,
      firstSeat: 1,
      revision: 0,
      turnTimeRemainingMs: 15_000,
    })
    expect(JSON.stringify(start.descriptor)).not.toContain('account-uuid-one')
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]?.delayMs).toBe(15_000)
    expect(pairedRoom.phase).toBe('active')
    expect(pairedRoom.readySeats.size).toBe(0)
  })

  it('keeps the room and rules stable while replacing the run with a fresh UUID and exactly one timer', () => {
    const { clearTimeout, dependencies, scheduled } = deterministicDependencies({
      firstSeats: [0, 1],
      seeds: [7, 8],
      uuids: ['stable-room-id', 'run-uuid-one', 'run-uuid-two'],
    })
    const coordinator = new MatchCoordinator(dependencies)
    coordinator.enqueueQuickMatch(firstParticipant)
    const room = coordinator.enqueueQuickMatch(secondParticipant)!

    coordinator.setReady(11, true)
    const firstStart = coordinator.setReady(22, true).start!
    coordinator.setReady(11, true)
    const secondStart = coordinator.setReady(22, true).start!

    expect(room.id).toBe('stable-room-id')
    expect(secondStart.room).toBe(room)
    expect(secondStart.run.id).toBe('run-uuid-two')
    expect(secondStart.run.id).not.toBe(firstStart.run.id)
    expect(secondStart.run.spec.rules).toBe(firstStart.run.spec.rules)
    expect(secondStart.run.spec.seed).toBe(8)
    expect(secondStart.run.spec.firstSeat).toBe(1)
    expect(clearTimeout).toHaveBeenCalledOnce()
    expect(clearTimeout).toHaveBeenCalledWith(scheduled[0]?.handle)
    expect(scheduled).toHaveLength(2)
    expect(room.currentRun).toBe(secondStart.run)
  })

  it('makes replaced and abandoned deadline callbacks inert and clears the active timer', () => {
    const onDeadline = vi.fn()
    const { clearTimeout, dependencies, scheduled } = deterministicDependencies({
      onDeadline,
      uuids: ['stable-room-id', 'run-uuid-one', 'run-uuid-two'],
    })
    const coordinator = new MatchCoordinator(dependencies)
    coordinator.enqueueQuickMatch(firstParticipant)
    coordinator.enqueueQuickMatch(secondParticipant)

    coordinator.setReady(11, true)
    coordinator.setReady(22, true)
    coordinator.setReady(11, true)
    const replacement = coordinator.setReady(22, true).start!

    scheduled[0]?.callback()
    expect(onDeadline).not.toHaveBeenCalled()
    scheduled[1]?.callback()
    expect(onDeadline).toHaveBeenCalledOnce()
    expect(onDeadline).toHaveBeenCalledWith(replacement.room, replacement.run)

    const abandoned = coordinator.abandon(11)
    expect(abandoned).toMatchObject({
      roomId: 'stable-room-id',
      remainingConnectionIds: [22],
    })
    expect(abandoned?.room.phase).toBe('abandoned')
    expect(abandoned?.room.currentRun?.phase).toBe('abandoned')
    expect(clearTimeout).toHaveBeenCalledTimes(2)
    expect(clearTimeout).toHaveBeenLastCalledWith(scheduled[1]?.handle)
    expect(coordinator.getRoomForConnection(11)).toBeUndefined()
    expect(coordinator.getRoomForConnection(22)).toBeUndefined()

    scheduled[1]?.callback()
    expect(onDeadline).toHaveBeenCalledOnce()
  })
})
