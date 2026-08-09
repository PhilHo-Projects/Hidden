import { DEFAULT_GAME_CONFIG, ENGINE_REVISION } from '@hidden/game-core'
import {
  applyCommand,
  applyTimeout,
  createGame,
  type GameCommand,
  type GameConfig,
  type Seat,
} from '@hidden/game-core'
import { describe, expect, it, vi } from 'vitest'
import {
  createMatchRoom,
  MatchCoordinator,
  type GameUpdateDelivery,
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
  const dependencies: Partial<MatchCoordinatorDependencies> = {
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
    const proposedConfig = {
      rounds: 999,
      turnSeconds: 0,
      blindMode: false,
    } satisfies Partial<GameConfig>

    expect(coordinator.enqueueQuickMatch(mutableFirst, proposedConfig)).toBeUndefined()
    const room = coordinator.enqueueQuickMatch(secondParticipant)

    expect(roomFactory).toHaveBeenCalledOnce()
    expect(roomFactory).toHaveBeenCalledWith({
      id: 'stable-room-id',
      participants: [
        { ...firstParticipant, seat: 0 },
        { accountId: undefined, ...secondParticipant, seat: 1 },
      ],
      config: { ...DEFAULT_GAME_CONFIG, rounds: 20, turnSeconds: 2, blindMode: false },
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
    expect(Object.isFrozen(room?.config)).toBe(true)

    mutableFirst.accountId = 'mutated-account'
    mutableFirst.username = 'Mutated_Name'
    proposedConfig.rounds = 1
    expect(room?.participants[0]).toMatchObject(firstParticipant)
    expect(room?.config).toEqual({ ...DEFAULT_GAME_CONFIG, rounds: 20, turnSeconds: 2, blindMode: false })
  })
})

describe('MatchCoordinator run lifecycle', () => {
  it('adds launch grace before the initial two-second placement window', () => {
    const { dependencies, scheduled } = deterministicDependencies({
      now: 1_000,
      uuids: ['stable-room-id', 'run-uuid-one'],
    })
    const coordinator = new MatchCoordinator(dependencies)
    coordinator.enqueueQuickMatch(firstParticipant, {
      rounds: 1,
      turnSeconds: 2,
      blindMode: true,
    })
    coordinator.enqueueQuickMatch(secondParticipant)

    coordinator.setReady(11, true)
    const start = coordinator.setReady(22, true).start!

    expect(start.descriptor.turnTimeRemainingMs).toBe(5_000)
    expect(start.run.deadline).toBe(6_000)
    expect(scheduled[0]?.delayMs).toBe(5_000)
  })

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
    expect(start.run.deadline).toBe(19_000)
    expect(start.run.spec).toEqual({
      engine: { id: 'classic', revision: ENGINE_REVISION },
      config: { ...DEFAULT_GAME_CONFIG, rounds: 8, turnSeconds: 15, blindMode: false },
      seed: 5,
      firstSeat: 1,
    })
    expect(Object.isFrozen(start.run.spec)).toBe(true)
    expect(start.run.state).toEqual(createGame(start.run.spec))
    expect(start.descriptor).toEqual({
      matchId: 'run-uuid-one',
      engine: { id: 'classic', revision: ENGINE_REVISION },
      config: { ...DEFAULT_GAME_CONFIG, rounds: 8, turnSeconds: 15, blindMode: false },
      seed: 5,
      firstSeat: 1,
      revision: 0,
      turnTimeRemainingMs: 18_000,
    })
    expect(JSON.stringify(start.descriptor)).not.toContain('account-uuid-one')
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]?.delayMs).toBe(18_000)
    expect(pairedRoom.phase).toBe('active')
    expect(pairedRoom.readySeats.size).toBe(0)
  })

  it('does not let premature ready packets replace an active run', () => {
    const { clearTimeout, dependencies, scheduled } = deterministicDependencies({
      firstSeats: [0],
      seeds: [7],
      uuids: ['stable-room-id', 'run-uuid-one'],
    })
    const coordinator = new MatchCoordinator(dependencies)
    coordinator.enqueueQuickMatch(firstParticipant)
    const room = coordinator.enqueueQuickMatch(secondParticipant)!

    coordinator.setReady(11, true)
    const firstStart = coordinator.setReady(22, true).start!
    const firstPremature = coordinator.setReady(11, true)
    const secondPremature = coordinator.setReady(22, true)

    expect(room.id).toBe('stable-room-id')
    expect(firstPremature.start).toBeUndefined()
    expect(secondPremature.start).toBeUndefined()
    expect(firstPremature.opponentConnectionIds).toEqual([])
    expect(secondPremature.opponentConnectionIds).toEqual([])
    expect(room.readySeats.size).toBe(0)
    expect(clearTimeout).not.toHaveBeenCalled()
    expect(scheduled).toHaveLength(1)
    expect(room.currentRun).toBe(firstStart.run)
  })

  it('makes abandoned deadline callbacks inert and clears the active timer', () => {
    const onDeadline = vi.fn()
    const { clearTimeout, dependencies, scheduled } = deterministicDependencies({
      onDeadline,
      uuids: ['stable-room-id', 'run-uuid-one'],
    })
    const coordinator = new MatchCoordinator(dependencies)
    coordinator.enqueueQuickMatch(firstParticipant)
    coordinator.enqueueQuickMatch(secondParticipant)

    coordinator.setReady(11, true)
    coordinator.setReady(22, true)

    const abandoned = coordinator.abandon(11)
    expect(abandoned).toMatchObject({
      roomId: 'stable-room-id',
      remainingConnectionIds: [22],
    })
    expect(abandoned?.room.phase).toBe('abandoned')
    expect(abandoned?.room.currentRun?.phase).toBe('abandoned')
    expect(clearTimeout).toHaveBeenCalledOnce()
    expect(clearTimeout).toHaveBeenLastCalledWith(scheduled[0]?.handle)
    expect(coordinator.getRoomForConnection(11)).toBeUndefined()
    expect(coordinator.getRoomForConnection(22)).toBeUndefined()

    scheduled[0]?.callback()
    expect(onDeadline).not.toHaveBeenCalled()
  })
})

interface TestEnvelope {
  matchId: string
  commandId: number
  expectedRevision: number
  command: Exclude<GameCommand, { type: 'timeout' }> | null
}

function authoritativeFixture(
  options: {
    cacheSize?: number
    firstSeat?: Seat
    now?: number
    onMatchCompleted?: (record: unknown) => void
    rounds?: number
    seed?: number
    turnSeconds?: number
    uuids?: string[]
  } = {},
) {
  const clock = { now: options.now ?? 1_000 }
  const uuids = [...(options.uuids ?? ['room-uuid', 'run-uuid', 'rematch-uuid'])]
  const scheduled: Array<{
    callback: () => void
    delayMs: number
    handle: { index: number }
  }> = []
  const cleared: unknown[] = []
  const pushedDeliveries: (readonly GameUpdateDelivery[])[] = []
  const coordinator = new MatchCoordinator({
    createUuid: () => uuids.shift() ?? 'unexpected-uuid',
    createSeed: () => options.seed ?? 7,
    chooseFirstSeat: () => options.firstSeat ?? 0,
    now: () => clock.now,
    scheduleTimeout: (callback, delayMs) => {
      const handle = { index: scheduled.length }
      scheduled.push({ callback, delayMs, handle })
      return handle
    },
    clearTimeout: (handle) => {
      cleared.push(handle)
    },
    commandCacheSize: options.cacheSize ?? 64,
    deliverySink: (deliveries) => pushedDeliveries.push(deliveries),
    ...(options.onMatchCompleted
      ? { onMatchCompleted: options.onMatchCompleted }
      : {}),
  })
  coordinator.enqueueQuickMatch(firstParticipant, {
    rounds: options.rounds ?? 20,
    turnSeconds: options.turnSeconds ?? 10,
    blindMode: false,
  })
  const room = coordinator.enqueueQuickMatch(secondParticipant)!
  coordinator.setReady(11, true)
  const start = coordinator.setReady(22, true).start!
  const nextCommandId: [number, number] = [1, 1]

  function envelope(
    command: TestEnvelope['command'],
    overrides: Partial<Omit<TestEnvelope, 'command'>> = {},
  ): TestEnvelope {
    return {
      matchId: start.run.id,
      commandId: 1,
      expectedRevision: Number(start.run.revision),
      command,
      ...overrides,
    }
  }

  function issue(
    seat: Seat,
    command: Exclude<GameCommand, { type: 'timeout' }>,
  ) {
    const commandId = nextCommandId[seat]++
    const deliveries = coordinator.handleGameCommand(
      room.participants[seat].connectionId,
      envelope(command, {
        commandId,
        expectedRevision: Number(start.run.revision),
      }),
    )
    const actor = deliveries.find(
      (delivery: { connectionId: number }) =>
        delivery.connectionId === room.participants[seat].connectionId,
    )
    expect(actor?.update).toMatchObject({ status: 'accepted', commandId })
    return deliveries
  }

  return {
    cleared,
    clock,
    coordinator,
    envelope,
    issue,
    pushedDeliveries,
    room,
    run: start.run,
    scheduled,
    start,
  }
}

function rejectionReason(deliveries: unknown[]) {
  expect(deliveries).toHaveLength(1)
  return (deliveries[0] as { update: { reason: string } }).update.reason
}

describe('MatchCoordinator authoritative command resolution', () => {
  it('derives the actor from the connection and sends convergent canonical updates to both seats', () => {
    const fixture = authoritativeFixture({ firstSeat: 0 })
    const initial = fixture.run.state
    const intent = fixture.envelope(
      { type: 'place', locationId: 4, symbol: 'rock' },
      { commandId: 17, expectedRevision: 0 },
    )

    const deliveries = fixture.coordinator.handleGameCommand(11, intent)
    const expected = applyCommand(initial, 0, intent.command!)

    expect(deliveries).toHaveLength(2)
    expect(deliveries[0]).toEqual({
      connectionId: 11,
      update: {
        status: 'accepted',
        matchId: 'run-uuid',
        commandId: 17,
        fromRevision: 0,
        toRevision: 1,
        actorSeat: 0,
        commands: [{ type: 'place', locationId: 4, symbol: 'rock' }],
        events: expected.events,
        turnTimeRemainingMs: 10_000,
      },
    })
    expect(deliveries[1]).toEqual({
      connectionId: 22,
      update: {
        ...deliveries[0]!.update,
        commandId: null,
      },
    })
    expect(fixture.run.state).toEqual(expected.state)
    expect(fixture.run.revision).toBe(1)
    expect(fixture.run.state.activeSeat).toBe(1)
  })

  it('rejects absent, wrong-match, stale, and out-of-turn intentions without mutation or opponent delivery', () => {
    const fixture = authoritativeFixture({ firstSeat: 0 })
    const initial = fixture.run.state

    expect(
      rejectionReason(
        fixture.coordinator.handleGameCommand(
          999,
          fixture.envelope({ type: 'place', locationId: 0, symbol: 'rock' }),
        ),
      ),
    ).toBe('no-active-match')
    expect(
      rejectionReason(
        fixture.coordinator.handleGameCommand(
          11,
          fixture.envelope(
            { type: 'place', locationId: 0, symbol: 'rock' },
            { matchId: 'spoofed-run' },
          ),
        ),
      ),
    ).toBe('wrong-match')
    expect(
      rejectionReason(
        fixture.coordinator.handleGameCommand(
          11,
          fixture.envelope(
            { type: 'place', locationId: 0, symbol: 'rock' },
            { expectedRevision: 4 },
          ),
        ),
      ),
    ).toBe('stale-revision')
    expect(
      rejectionReason(
        fixture.coordinator.handleGameCommand(
          22,
          fixture.envelope({ type: 'place', locationId: 0, symbol: 'rock' }),
        ),
      ),
    ).toBe('not-active-seat')

    expect(fixture.run.state).toBe(initial)
    expect(fixture.run.revision).toBe(0)
    expect(fixture.scheduled).toHaveLength(1)
  })

  it('maps malformed commands and every core legality rejection without changing revision', () => {
    const fixture = authoritativeFixture({ firstSeat: 0 })

    expect(
      rejectionReason(fixture.coordinator.handleGameCommand(11, fixture.envelope(null))),
    ).toBe('invalid-command')
    expect(
      rejectionReason(
        fixture.coordinator.handleGameCommand(
          11,
          fixture.envelope({ type: 'place', locationId: 999, symbol: 'rock' }),
        ),
      ),
    ).toBe('unknown-location')
    expect(
      rejectionReason(
        fixture.coordinator.handleGameCommand(
          11,
          fixture.envelope({ type: 'activate-powerup', powerup: 'shield' }),
        ),
      ),
    ).toBe('powerup-locked')
    expect(
      rejectionReason(
        fixture.coordinator.handleGameCommand(
          11,
          fixture.envelope({ type: 'select-shield-target', locationId: 0 }),
        ),
      ),
    ).toBe('shield-selection-not-pending')
    expect(fixture.run.revision).toBe(0)

    fixture.issue(0, { type: 'place', locationId: 0, symbol: 'rock' })
    fixture.issue(1, { type: 'place', locationId: 3, symbol: 'paper' })
    expect(
      rejectionReason(
        fixture.coordinator.handleGameCommand(
          11,
          fixture.envelope(
            { type: 'place', locationId: 0, symbol: 'scissors' },
            { commandId: 99, expectedRevision: Number(fixture.run.revision) },
          ),
        ),
      ),
    ).toBe('location-occupied')

    fixture.issue(0, { type: 'place', locationId: 1, symbol: 'rock' })
    fixture.issue(1, { type: 'place', locationId: 4, symbol: 'paper' })
    fixture.issue(0, { type: 'place', locationId: 2, symbol: 'rock' })
    fixture.issue(1, { type: 'place', locationId: 5, symbol: 'paper' })
    fixture.issue(0, { type: 'activate-powerup', powerup: 'shield' })
    const revision = Number(fixture.run.revision)

    expect(
      rejectionReason(
        fixture.coordinator.handleGameCommand(
          11,
          fixture.envelope(
            { type: 'place', locationId: 6, symbol: 'rock' },
            { commandId: 100, expectedRevision: revision },
          ),
        ),
      ),
    ).toBe('shield-selection-pending')
    expect(
      rejectionReason(
        fixture.coordinator.handleGameCommand(
          11,
          fixture.envelope(
            { type: 'activate-powerup', powerup: 'shield' },
            { commandId: 101, expectedRevision: revision },
          ),
        ),
      ),
    ).toBe('powerup-used')
    expect(
      rejectionReason(
        fixture.coordinator.handleGameCommand(
          11,
          fixture.envelope(
            { type: 'select-shield-target', locationId: 8 },
            { commandId: 102, expectedRevision: revision },
          ),
        ),
      ),
    ).toBe('invalid-shield-target')
    expect(fixture.run.revision).toBe(revision)
  })

  it('resends an exact accepted duplicate only to its actor and rejects conflicting or evicted IDs', () => {
    const fixture = authoritativeFixture({ cacheSize: 1, firstSeat: 0 })
    const first = fixture.envelope(
      { type: 'place', locationId: 0, symbol: 'rock' },
      { commandId: 1, expectedRevision: 0 },
    )
    const accepted = fixture.coordinator.handleGameCommand(11, first)
    const duplicate = fixture.coordinator.handleGameCommand(11, first)

    expect(duplicate).toEqual([accepted[0]])
    expect(fixture.run.revision).toBe(1)
    expect(fixture.scheduled).toHaveLength(2)
    expect(
      rejectionReason(
        fixture.coordinator.handleGameCommand(11, {
          ...first,
          command: { type: 'place', locationId: 1, symbol: 'paper' },
        }),
      ),
    ).toBe('command-id-reused')

    fixture.coordinator.handleGameCommand(
      22,
      fixture.envelope(
        { type: 'place', locationId: 1, symbol: 'paper' },
        { commandId: 1, expectedRevision: 1 },
      ),
    )
    fixture.coordinator.handleGameCommand(
      11,
      fixture.envelope(
        { type: 'place', locationId: 2, symbol: 'scissors' },
        { commandId: 2, expectedRevision: 2 },
      ),
    )
    expect(fixture.run.revision).toBe(3)
    expect(
      rejectionReason(
        fixture.coordinator.handleGameCommand(
          11,
          fixture.envelope(
            { type: 'place', locationId: 3, symbol: 'rock' },
            { commandId: 1, expectedRevision: 3 },
          ),
        ),
      ),
    ).toBe('command-id-reused')
    expect(fixture.run.revision).toBe(3)
  })

  it('accepts an unused lower command id because command ids are not required to be monotonic', () => {
    const fixture = authoritativeFixture({ cacheSize: 1, firstSeat: 0 })
    fixture.coordinator.handleGameCommand(
      11,
      fixture.envelope(
        { type: 'place', locationId: 0, symbol: 'rock' },
        { commandId: 10, expectedRevision: 0 },
      ),
    )
    fixture.coordinator.handleGameCommand(
      22,
      fixture.envelope(
        { type: 'place', locationId: 1, symbol: 'paper' },
        { commandId: 10, expectedRevision: 1 },
      ),
    )

    const lowerUnused = fixture.coordinator.handleGameCommand(
      11,
      fixture.envelope(
        { type: 'place', locationId: 2, symbol: 'scissors' },
        { commandId: 5, expectedRevision: 2 },
      ),
    )

    expect(lowerUnused[0]?.update).toMatchObject({
      status: 'accepted',
      commandId: 5,
      fromRevision: 2,
      toRevision: 3,
    })
    expect(fixture.run.commandCaches[0].size).toBe(1)
  })

  it('delivers expiry before rejecting an old exact duplicate instead of replaying an older revision', () => {
    const fixture = authoritativeFixture({ firstSeat: 0 })
    const first = fixture.envelope(
      { type: 'place', locationId: 0, symbol: 'rock' },
      { commandId: 1, expectedRevision: 0 },
    )
    fixture.coordinator.handleGameCommand(11, first)
    fixture.clock.now = fixture.run.deadline

    const lateDuplicate = fixture.coordinator.handleGameCommand(11, first)

    expect(lateDuplicate).toHaveLength(3)
    expect(lateDuplicate.slice(0, 2)).toEqual([
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'accepted',
          fromRevision: 1,
          toRevision: 2,
          commands: [{ type: 'timeout' }],
        }),
      }),
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'accepted',
          fromRevision: 1,
          toRevision: 2,
          commands: [{ type: 'timeout' }],
        }),
      }),
    ])
    expect(lateDuplicate[2]).toMatchObject({
      connectionId: 11,
      update: {
        status: 'rejected',
        currentRevision: 2,
        reason: 'stale-revision',
      },
    })
    expect(lateDuplicate).not.toContainEqual(
      expect.objectContaining({
        update: expect.objectContaining({ fromRevision: 0, toRevision: 1 }),
      }),
    )
  })
})

describe('MatchCoordinator authoritative placement deadlines', () => {
  it('resets placement windows but does not extend accepted power-up setup', () => {
    const fixture = authoritativeFixture({ firstSeat: 0 })
    fixture.issue(0, { type: 'place', locationId: 0, symbol: 'rock' })
    expect(fixture.cleared).toEqual([fixture.scheduled[0]?.handle])
    expect(fixture.scheduled.at(-1)?.delayMs).toBe(10_000)

    fixture.issue(1, { type: 'place', locationId: 3, symbol: 'paper' })
    fixture.issue(0, { type: 'place', locationId: 1, symbol: 'rock' })
    fixture.issue(1, { type: 'place', locationId: 4, symbol: 'paper' })
    fixture.issue(0, { type: 'place', locationId: 2, symbol: 'rock' })
    fixture.issue(1, { type: 'place', locationId: 5, symbol: 'paper' })
    const schedulesBeforeSetup = fixture.scheduled.length
    const deadlineBeforeSetup = fixture.run.deadline

    fixture.clock.now += 1_000
    const activated = fixture.issue(0, {
      type: 'activate-powerup',
      powerup: 'shield',
    })
    expect(fixture.scheduled).toHaveLength(schedulesBeforeSetup)
    expect(fixture.run.deadline).toBe(deadlineBeforeSetup)
    expect(activated[0]?.update).toMatchObject({ turnTimeRemainingMs: 9_000 })

    fixture.clock.now += 1_000
    const selected = fixture.issue(0, {
      type: 'select-shield-target',
      locationId: 0,
    })
    expect(fixture.scheduled).toHaveLength(schedulesBeforeSetup)
    expect(fixture.run.deadline).toBe(deadlineBeforeSetup)
    expect(selected[0]?.update).toMatchObject({ turnTimeRemainingMs: 8_000 })
  })

  it('makes replaced timer callbacks inert and lets the current callback deliver one seeded timeout', () => {
    const fixture = authoritativeFixture({ firstSeat: 0, seed: 1 })
    const initial = fixture.run.state
    fixture.issue(0, { type: 'place', locationId: 0, symbol: 'rock' })
    const afterPlacement = fixture.run.state
    const expectedTimeout = applyTimeout(afterPlacement)

    fixture.scheduled[0]?.callback()
    expect(fixture.pushedDeliveries).toHaveLength(0)

    fixture.clock.now = fixture.run.deadline
    fixture.scheduled[1]?.callback()
    expect(fixture.pushedDeliveries).toHaveLength(1)
    expect(fixture.pushedDeliveries[0]).toHaveLength(2)
    expect(fixture.pushedDeliveries[0]?.[0]).toMatchObject({
      update: {
        status: 'accepted',
        commandId: null,
        fromRevision: 1,
        toRevision: 2,
        actorSeat: 1,
        commands: [{ type: 'timeout' }],
      },
    })
    expect(fixture.run.state).not.toBe(initial)
    expect(fixture.run.state).toEqual(expectedTimeout.state)
    expect(fixture.run.revision).toBe(2)
    expect(fixture.scheduled).toHaveLength(3)
    expect(fixture.cleared).not.toContain(fixture.scheduled[1]?.handle)
  })

  it('delivers an already-expired timeout before evaluating a late command', () => {
    const fixture = authoritativeFixture({ firstSeat: 0, now: 1_000 })
    fixture.clock.now = fixture.run.deadline + 1

    const deliveries = fixture.coordinator.handleGameCommand(
      11,
      fixture.envelope(
        { type: 'place', locationId: 0, symbol: 'rock' },
        { commandId: 1, expectedRevision: 0 },
      ),
    )

    expect(deliveries).toHaveLength(3)
    expect(deliveries.slice(0, 2)).toEqual([
      expect.objectContaining({
        connectionId: 11,
        update: expect.objectContaining({
          status: 'accepted',
          commandId: null,
          fromRevision: 0,
          toRevision: 1,
          commands: [{ type: 'timeout' }],
        }),
      }),
      expect.objectContaining({
        connectionId: 22,
        update: expect.objectContaining({
          status: 'accepted',
          commandId: null,
          fromRevision: 0,
          toRevision: 1,
        }),
      }),
    ])
    expect(deliveries[2]).toMatchObject({
      connectionId: 11,
      update: {
        status: 'rejected',
        currentRevision: 1,
        reason: 'stale-revision',
      },
    })
    expect(fixture.run.revision).toBe(1)
    expect(fixture.cleared).toContain(fixture.scheduled[0]?.handle)
  })
})

function unlockExtraTurn(fixture: ReturnType<typeof authoritativeFixture>) {
  for (const locationId of [0, 1, 2]) {
    fixture.issue(0, { type: 'place', locationId, symbol: 'scissors' })
    fixture.issue(1, { type: 'place', locationId, symbol: 'paper' })
  }
  fixture.issue(0, {
    type: 'activate-powerup',
    powerup: 'extraTurn',
  })
}

describe('MatchCoordinator extra-turn delivery batching', () => {
  it('confirms each placement to the actor while buffering a combined range for the opponent', () => {
    const fixture = authoritativeFixture({ firstSeat: 0 })
    unlockExtraTurn(fixture)
    const firstRevision = Number(fixture.run.revision)
    const schedulesBeforePair = fixture.scheduled.length

    const first = fixture.issue(0, {
      type: 'place',
      locationId: 6,
      symbol: 'rock',
    })
    expect(first).toHaveLength(1)
    expect(fixture.scheduled).toHaveLength(schedulesBeforePair + 1)
    expect(first[0]).toMatchObject({
      connectionId: 11,
      update: {
        fromRevision: firstRevision,
        toRevision: firstRevision + 1,
        commands: [{ type: 'place', locationId: 6, symbol: 'rock' }],
      },
    })

    const second = fixture.issue(0, {
      type: 'place',
      locationId: 7,
      symbol: 'paper',
    })
    expect(second).toHaveLength(2)
    expect(fixture.scheduled).toHaveLength(schedulesBeforePair + 2)
    expect(second[0]).toMatchObject({
      connectionId: 11,
      update: {
        commandId: expect.any(Number),
        fromRevision: firstRevision + 1,
        toRevision: firstRevision + 2,
        commands: [{ type: 'place', locationId: 7, symbol: 'paper' }],
      },
    })
    expect(second[1]).toMatchObject({
      connectionId: 22,
      update: {
        commandId: null,
        fromRevision: firstRevision,
        toRevision: firstRevision + 2,
        commands: [
          { type: 'place', locationId: 6, symbol: 'rock' },
          { type: 'place', locationId: 7, symbol: 'paper' },
        ],
      },
    })
    expect(fixture.run.state.activeSeat).toBe(1)
  })

  it('combines a buffered first placement with a server timeout for the opponent', () => {
    const fixture = authoritativeFixture({ firstSeat: 0, seed: 1 })
    unlockExtraTurn(fixture)
    const firstRevision = Number(fixture.run.revision)
    fixture.issue(0, { type: 'place', locationId: 6, symbol: 'rock' })

    fixture.clock.now = fixture.run.deadline
    fixture.scheduled.at(-1)?.callback()

    expect(fixture.pushedDeliveries).toHaveLength(1)
    const delivered = fixture.pushedDeliveries[0]!
    expect(delivered).toHaveLength(2)
    expect(delivered[0]).toMatchObject({
      connectionId: 11,
      update: {
        commandId: null,
        fromRevision: firstRevision + 1,
        toRevision: firstRevision + 2,
        commands: [{ type: 'timeout' }],
      },
    })
    expect(delivered[1]).toMatchObject({
      connectionId: 22,
      update: {
        commandId: null,
        fromRevision: firstRevision,
        toRevision: firstRevision + 2,
        commands: [
          { type: 'place', locationId: 6, symbol: 'rock' },
          { type: 'timeout' },
        ],
      },
    })
  })

  it('buffers a timeout that becomes the first extra placement and flushes both timeouts after the second', () => {
    const fixture = authoritativeFixture({ firstSeat: 0, seed: 1 })
    unlockExtraTurn(fixture)
    const firstRevision = Number(fixture.run.revision)

    fixture.clock.now = fixture.run.deadline
    fixture.scheduled.at(-1)?.callback()

    expect(fixture.pushedDeliveries).toHaveLength(1)
    expect(fixture.pushedDeliveries[0]).toEqual([
      expect.objectContaining({
        connectionId: 11,
        update: expect.objectContaining({
          commandId: null,
          fromRevision: firstRevision,
          toRevision: firstRevision + 1,
          commands: [{ type: 'timeout' }],
        }),
      }),
    ])
    expect(fixture.run.state.powerups[0].extraTurnInProgress).toBe(true)

    fixture.clock.now = fixture.run.deadline
    fixture.scheduled.at(-1)?.callback()

    const second = fixture.pushedDeliveries[1]!
    expect(second).toHaveLength(2)
    expect(second[0]).toMatchObject({
      connectionId: 11,
      update: {
        fromRevision: firstRevision + 1,
        toRevision: firstRevision + 2,
        commands: [{ type: 'timeout' }],
      },
    })
    expect(second[1]).toMatchObject({
      connectionId: 22,
      update: {
        fromRevision: firstRevision,
        toRevision: firstRevision + 2,
        commands: [{ type: 'timeout' }, { type: 'timeout' }],
      },
    })
  })

  it('delivers an armed first placement immediately when no legal second placement exists', () => {
    const fixture = authoritativeFixture({ firstSeat: 0 })
    for (const locationId of [0, 1, 2, 3, 4, 5, 6, 7]) {
      fixture.issue(0, { type: 'place', locationId, symbol: 'scissors' })
      fixture.issue(1, { type: 'place', locationId, symbol: 'paper' })
    }
    fixture.issue(0, {
      type: 'activate-powerup',
      powerup: 'extraTurn',
    })

    const result = fixture.issue(0, {
      type: 'place',
      locationId: 8,
      symbol: 'scissors',
    })

    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({
      connectionId: 22,
      update: {
        commands: [{ type: 'place', locationId: 8, symbol: 'scissors' }],
        events: expect.arrayContaining([
          expect.objectContaining({ type: 'turn-passed', seat: 0 }),
        ]),
      },
    })
    expect(fixture.run.state.powerups[0].extraTurnInProgress).toBe(false)
  })
})

describe('MatchCoordinator finish, rematch, and legacy lifecycle', () => {
  it('emits one immutable final snapshot when an online run completes', () => {
    const completed: unknown[] = []
    const fixture = authoritativeFixture({
      firstSeat: 0,
      now: 8_000,
      onMatchCompleted: (record) => completed.push(record),
      rounds: 1,
      uuids: ['stable-room', 'finished-run'],
    })

    fixture.issue(0, { type: 'place', locationId: 0, symbol: 'rock' })
    const finishing = fixture.issue(1, {
      type: 'place',
      locationId: 1,
      symbol: 'paper',
    })

    expect(completed).toEqual([
      {
        schemaVersion: 1,
        matchId: 'finished-run',
        completedAtMs: 8_000,
        engine: { id: 'classic', revision: ENGINE_REVISION },
        config: {
          ...DEFAULT_GAME_CONFIG,
          rounds: 1,
          turnSeconds: 10,
          blindMode: false,
        },
        turnCount: 2,
        participants: [
          {
            seat: 0,
            accountId: 'account-uuid-one',
            username: 'Account_One',
          },
          { seat: 1, username: 'Guest#0022' },
        ],
        result: { scores: [1, 1], winner: null },
        boards: [
          {
            columns: 3,
            cells: [
              { locationId: 0, symbol: 'rock' },
              { locationId: 1, symbol: null },
              { locationId: 2, symbol: null },
              { locationId: 3, symbol: null },
              { locationId: 4, symbol: null },
              { locationId: 5, symbol: null },
              { locationId: 6, symbol: null },
              { locationId: 7, symbol: null },
              { locationId: 8, symbol: null },
            ],
          },
          {
            columns: 3,
            cells: [
              { locationId: 0, symbol: null },
              { locationId: 1, symbol: 'paper' },
              { locationId: 2, symbol: null },
              { locationId: 3, symbol: null },
              { locationId: 4, symbol: null },
              { locationId: 5, symbol: null },
              { locationId: 6, symbol: null },
              { locationId: 7, symbol: null },
              { locationId: 8, symbol: null },
            ],
          },
        ],
      },
    ])
    expect(Object.isFrozen(completed[0])).toBe(true)

    const exactFinishingRetry = fixture.coordinator.handleGameCommand(
      22,
      fixture.envelope(
        { type: 'place', locationId: 1, symbol: 'paper' },
        { commandId: 1, expectedRevision: 1 },
      ),
    )
    expect(exactFinishingRetry).toEqual([finishing[0]])
    expect(completed).toHaveLength(1)
  })

  it('does not emit a final snapshot for an abandoned run', () => {
    const completed: unknown[] = []
    const fixture = authoritativeFixture({
      onMatchCompleted: (record) => completed.push(record),
    })

    fixture.coordinator.abandon(11)

    expect(completed).toEqual([])
  })

  it('locks a configured-limit finish, clears its timer, and starts a fresh run only after both finished seats ready', () => {
    const fixture = authoritativeFixture({
      firstSeat: 0,
      rounds: 1,
      uuids: ['stable-room', 'first-run', 'second-run'],
    })
    fixture.issue(0, { type: 'place', locationId: 0, symbol: 'rock' })
    const finishing = fixture.issue(1, {
      type: 'place',
      locationId: 1,
      symbol: 'paper',
    })

    expect(fixture.run.state.result).toEqual({ scores: [1, 1], winner: null })
    expect(fixture.run.phase).toBe('finished')
    expect(fixture.room.phase).toBe('finished')
    expect(fixture.cleared).toContain(fixture.scheduled.at(-1)?.handle)
    expect(finishing).toHaveLength(2)
    expect(finishing[0]?.update).toMatchObject({
      status: 'accepted',
      turnTimeRemainingMs: null,
      events: expect.arrayContaining([
        { type: 'game-finished', scores: [1, 1], winner: null },
      ]),
    })
    const revision = Number(fixture.run.revision)
    expect(
      rejectionReason(
        fixture.coordinator.handleGameCommand(
          11,
          fixture.envelope(
            { type: 'place', locationId: 2, symbol: 'rock' },
            { commandId: 99, expectedRevision: revision },
          ),
        ),
      ),
    ).toBe('game-finished')
    expect(fixture.run.revision).toBe(revision)

    const exactFinishingRetry = fixture.coordinator.handleGameCommand(
      22,
      fixture.envelope(
        { type: 'place', locationId: 1, symbol: 'paper' },
        { commandId: 1, expectedRevision: 1 },
      ),
    )
    expect(exactFinishingRetry).toEqual([finishing[0]])
    expect(fixture.run.revision).toBe(revision)

    expect(fixture.coordinator.setReady(11, true).start).toBeUndefined()
    const rematch = fixture.coordinator.setReady(22, true).start!
    expect(rematch.run.id).toBe('second-run')
    expect(rematch.run.id).not.toBe(fixture.run.id)
    expect(rematch.room.id).toBe('stable-room')
    expect(rematch.run.spec.config).toBe(fixture.run.spec.config)
    expect(rematch.run.revision).toBe(0)
  })

  it('rejects legacy gameplay for a current run without mutation or opponent relay', () => {
    const fixture = authoritativeFixture({ firstSeat: 0 })
    const state = fixture.run.state

    const deliveries = fixture.coordinator.rejectLegacyGameplay(11)

    expect(deliveries).toEqual([
      {
        connectionId: 11,
        update: {
          status: 'rejected',
          matchId: 'run-uuid',
          commandId: null,
          currentRevision: 0,
          reason: 'legacy-gameplay-disabled',
        },
      },
    ])
    expect(fixture.run.state).toBe(state)
    expect(fixture.run.revision).toBe(0)
  })
})

describe('MatchCoordinator private lobby', () => {
  const host = { connectionId: 1, username: 'Host' }
  const joiner = { connectionId: 2, username: 'Joiner' }

  function lobbyCoordinator(codes = ['AAAAA', 'BBBBB', 'CCCCC']) {
    const queue = [...codes]
    return new MatchCoordinator({
      createUuid: () => 'room-1',
      createJoinCode: () => queue.shift() ?? 'ZZZZZ',
      now: () => 1_000,
    })
  }

  function asPending(result: ReturnType<MatchCoordinator['createPendingGame']>) {
    if ('error' in result) throw new Error(`Unexpected error: ${result.error}`)
    return result
  }

  it('creates a game with a join code and the host config', () => {
    const coordinator = lobbyCoordinator()
    const pending = asPending(
      coordinator.createPendingGame(
        host,
        { ...DEFAULT_GAME_CONFIG, boardSize: 5, streak: 4 },
        false,
      ),
    )
    expect(pending.code).toBe('AAAAA')
    expect(pending.config.boardSize).toBe(5)
    expect(pending.host.username).toBe('Host')
  })

  it('clamps a hostile host config rather than trusting it', () => {
    const coordinator = lobbyCoordinator()
    const pending = asPending(
      coordinator.createPendingGame(
        host,
        { ...DEFAULT_GAME_CONFIG, rounds: 9_999, boardSize: 99 } as never,
        false,
      ),
    )
    expect(pending.config.rounds).toBe(20)
    expect(pending.config.boardSize).toBe(5)
  })

  it('lists public games and omits private ones', () => {
    const coordinator = lobbyCoordinator()
    coordinator.createPendingGame(host, DEFAULT_GAME_CONFIG, false)
    coordinator.createPendingGame(
      { connectionId: 3, username: 'Secret' },
      DEFAULT_GAME_CONFIG,
      true,
    )

    const listed = coordinator.listPublicGames()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ code: 'AAAAA', hostName: 'Host' })
  })

  it('joins a private game by code even though it is unlisted', () => {
    const coordinator = lobbyCoordinator()
    coordinator.createPendingGame(host, DEFAULT_GAME_CONFIG, true)
    const room = coordinator.joinPendingGame('AAAAA', joiner)
    if ('error' in room) throw new Error('Expected a room.')
    expect(room.participants.map((p) => p.username)).toEqual(['Host', 'Joiner'])
  })

  it('gives the created room the host config, not the default', () => {
    const coordinator = lobbyCoordinator()
    coordinator.createPendingGame(
      host,
      { ...DEFAULT_GAME_CONFIG, boardSize: 4, streak: 3, powerupsEnabled: false },
      false,
    )
    const room = coordinator.joinPendingGame('AAAAA', joiner)
    if ('error' in room) throw new Error('Expected a room.')
    expect(room.config.boardSize).toBe(4)
    expect(room.config.powerupsEnabled).toBe(false)
  })

  it('removes the game from the list once joined', () => {
    const coordinator = lobbyCoordinator()
    coordinator.createPendingGame(host, DEFAULT_GAME_CONFIG, false)
    coordinator.joinPendingGame('AAAAA', joiner)
    expect(coordinator.listPublicGames()).toEqual([])
  })

  it('rejects an unknown code, your own game, and hosting twice', () => {
    const coordinator = lobbyCoordinator()
    expect(coordinator.joinPendingGame('NOPE1', joiner)).toEqual({
      error: 'not-found',
    })
    coordinator.createPendingGame(host, DEFAULT_GAME_CONFIG, false)
    expect(coordinator.joinPendingGame('AAAAA', host)).toEqual({
      error: 'own-game',
    })
    expect(
      coordinator.createPendingGame(host, DEFAULT_GAME_CONFIG, false),
    ).toEqual({ error: 'already-hosting' })
  })

  it('cancels a hosted game', () => {
    const coordinator = lobbyCoordinator()
    coordinator.createPendingGame(host, DEFAULT_GAME_CONFIG, false)
    expect(coordinator.cancelPendingGame(host.connectionId)).toBe(true)
    expect(coordinator.listPublicGames()).toEqual([])
    expect(coordinator.cancelPendingGame(host.connectionId)).toBe(false)
  })

  it('drops a hosted game when the host disconnects', () => {
    const coordinator = lobbyCoordinator()
    coordinator.createPendingGame(host, DEFAULT_GAME_CONFIG, false)
    coordinator.abandon(host.connectionId)
    expect(coordinator.listPublicGames()).toEqual([])
    expect(coordinator.joinPendingGame('AAAAA', joiner)).toEqual({
      error: 'not-found',
    })
  })

  it('retries until it finds an unused join code', () => {
    // Both hosts draw 'AAAAA' first; the second must not overwrite the first.
    const coordinator = lobbyCoordinator(['AAAAA', 'AAAAA', 'BBBBB'])
    coordinator.createPendingGame(host, DEFAULT_GAME_CONFIG, false)
    const second = asPending(
      coordinator.createPendingGame(
        { connectionId: 3, username: 'Other' },
        DEFAULT_GAME_CONFIG,
        false,
      ),
    )
    expect(second.code).toBe('BBBBB')
    expect(coordinator.listPublicGames()).toHaveLength(2)
  })
})
