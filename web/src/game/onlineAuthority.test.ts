import { describe, expect, it } from 'vitest'
import {
  applyCommand,
  applyTimeout,
  createGame,
  type DomainEvent,
  type GameCommand,
  type Seat,
} from '@hidden/game-core'
import {
  applyOnlineUpdate,
  createOnlineAuthority,
  getDisplayedTurnTimeMs,
  queueOnlineCommand,
  type OnlineGameUpdate,
} from './onlineAuthority'
import type { AcceptedGameUpdate, GameStartDescriptor } from './protocol'

const descriptor: GameStartDescriptor = {
  matchId: 'match-1',
  mode: { id: 'classic', revision: 1 },
  rules: { rounds: 6, turnSeconds: 10, blindMode: true },
  seed: 42,
  firstSeat: 0,
  revision: 0,
  turnTimeRemainingMs: 10_000,
}

function accepted(
  fromRevision: number,
  actorSeat: 0 | 1,
  commands: GameCommand[],
  events: DomainEvent[] = [],
): AcceptedGameUpdate {
  return {
    status: 'accepted',
    matchId: descriptor.matchId,
    commandId: null,
    fromRevision,
    toRevision: fromRevision + commands.length,
    actorSeat,
    commands,
    events,
    turnTimeRemainingMs: 9_000,
  }
}

describe('online authority', () => {
  it('derives the local seat from trusted start information and resets rematch command ids', () => {
    const first = createOnlineAuthority(descriptor, 17, 17, 1_000)
    expect(first.localSeat).toBe(0)
    expect(first.canonical.activeSeat).toBe(0)

    const queued = queueOnlineCommand(first, {
      type: 'place', locationId: 0, symbol: 'rock',
    })
    expect(queued.envelope?.commandId).toBe(0)

    const rematch = createOnlineAuthority(
      { ...descriptor, matchId: 'match-2', seed: 99, firstSeat: 1 },
      17,
      21,
      5_000,
    )
    expect(rematch.matchId).toBe('match-2')
    expect(rematch.localSeat).toBe(0)
    expect(rematch.revision).toBe(0)
    expect(rematch.nextCommandId).toBe(0)
    expect(rematch.pending).toBeNull()
  })

  it.each([
    { type: 'place', locationId: 0, symbol: 'paper' } as const,
    { type: 'activate-powerup', powerup: 'shield' } as const,
    { type: 'select-shield-target', locationId: 0 } as const,
  ])('queues $type without mutating canonical state or revision', (command) => {
    const initial = createOnlineAuthority(descriptor, 17, 17, 1_000)
    const queued = queueOnlineCommand(initial, command)

    expect(queued.envelope).toEqual({
      matchId: 'match-1',
      commandId: 0,
      expectedRevision: 0,
      command,
    })
    expect(queued.state.canonical).toBe(initial.canonical)
    expect(queued.state.revision).toBe(0)
    expect(queued.state.pending).toEqual({ commandId: 0, command })
    expect(queueOnlineCommand(queued.state, command).envelope).toBeNull()
  })

  it('does not queue an intention when the trusted local seat is not active', () => {
    const waiting = createOnlineAuthority(
      { ...descriptor, firstSeat: 1 },
      21,
      17,
      1_000,
    )
    const result = queueOnlineCommand(waiting, {
      type: 'place', locationId: 0, symbol: 'rock',
    })
    expect(result.envelope).toBeNull()
    expect(result.state).toBe(waiting)
  })

  it('applies accepted commands only after confirmation and converges both clients', () => {
    const left = queueOnlineCommand(
      createOnlineAuthority(descriptor, 17, 17, 1_000),
      { type: 'place', locationId: 0, symbol: 'rock' },
    ).state
    const right = createOnlineAuthority(descriptor, 17, 21, 1_000)
    const update = {
      ...accepted(
        0,
        0,
        [{ type: 'place', locationId: 0, symbol: 'rock' }],
        [{
          type: 'placements-committed',
          seat: 0,
          placements: [{ locationId: 0, symbol: 'rock' }],
        }],
      ),
      commandId: 0,
    }

    const leftResult = applyOnlineUpdate(left, update, 2_000)
    const rightResult = applyOnlineUpdate(right, { ...update, commandId: null }, 2_000)

    expect(leftResult.state.status).toBe('synchronized')
    expect(leftResult.state.pending).toBeNull()
    expect(leftResult.state.revision).toBe(1)
    expect(leftResult.state.canonical).toEqual(rightResult.state.canonical)
    expect(leftResult.events).toEqual(update.events)
    expect(leftResult.clearLocalSelection).toBe(true)
  })

  it('clears local move selection when the server times out the local seat', () => {
    const initial = createOnlineAuthority(descriptor, 17, 17, 1_000)
    const timeout = applyTimeout(initial.canonical)
    if (!timeout.accepted) throw new Error('Fixture timeout must be accepted.')
    const result = applyOnlineUpdate(initial, {
      status: 'accepted',
      matchId: descriptor.matchId,
      commandId: null,
      fromRevision: 0,
      toRevision: 1,
      actorSeat: 0,
      commands: [{ type: 'timeout' }],
      events: timeout.events,
      turnTimeRemainingMs: 10_000,
    }, 2_000)

    expect(result.state.status).toBe('synchronized')
    expect(result.clearLocalSelection).toBe(true)
  })

  it('fails closed when a pending local command id is accepted for the opponent seat', () => {
    const queued = queueOnlineCommand(
      createOnlineAuthority(descriptor, 17, 17, 1_000),
      { type: 'place', locationId: 0, symbol: 'rock' },
    ).state
    const timeout = applyTimeout(queued.canonical)
    if (!timeout.accepted) throw new Error('Fixture timeout must be accepted.')
    const afterTimeout = applyOnlineUpdate(queued, {
      status: 'accepted',
      matchId: descriptor.matchId,
      commandId: null,
      fromRevision: 0,
      toRevision: 1,
      actorSeat: 0,
      commands: [{ type: 'timeout' }],
      events: timeout.events,
      turnTimeRemainingMs: 10_000,
    }, 2_000).state
    expect(afterTimeout.pending?.commandId).toBe(0)
    expect(afterTimeout.canonical.activeSeat).toBe(1)

    const opponentPlacement = applyCommand(afterTimeout.canonical, 1, {
      type: 'place', locationId: 0, symbol: 'rock',
    })
    if (!opponentPlacement.accepted) {
      throw new Error('Fixture opponent placement must be accepted.')
    }
    const result = applyOnlineUpdate(afterTimeout, {
      status: 'accepted',
      matchId: descriptor.matchId,
      commandId: 0,
      fromRevision: 1,
      toRevision: 2,
      actorSeat: 1,
      commands: [{ type: 'place', locationId: 0, symbol: 'rock' }],
      events: opponentPlacement.events,
      turnTimeRemainingMs: 10_000,
    }, 3_000)

    expect(result.state.status).toBe('sync-lost')
  })

  it('fails closed when an active replay reports no remaining deadline', () => {
    const initial = createOnlineAuthority(descriptor, 17, 17, 1_000)
    const placement = applyCommand(initial.canonical, 0, {
      type: 'place', locationId: 0, symbol: 'paper',
    })
    if (!placement.accepted) throw new Error('Fixture placement must be accepted.')
    const result = applyOnlineUpdate(initial, {
      status: 'accepted',
      matchId: descriptor.matchId,
      commandId: null,
      fromRevision: 0,
      toRevision: 1,
      actorSeat: 0,
      commands: [{ type: 'place', locationId: 0, symbol: 'paper' }],
      events: placement.events,
      turnTimeRemainingMs: null,
    }, 2_000)

    expect(placement.state.phase).toBe('active')
    expect(result.state.status).toBe('sync-lost')
  })

  it('fails closed when a finished replay reports a live deadline', () => {
    const oneRoundDescriptor: GameStartDescriptor = {
      ...descriptor,
      rules: { ...descriptor.rules, rounds: 1 },
    }
    const initial = createOnlineAuthority(oneRoundDescriptor, 17, 17, 1_000)
    const firstPlacement = applyCommand(initial.canonical, 0, {
      type: 'place', locationId: 0, symbol: 'rock',
    })
    if (!firstPlacement.accepted) throw new Error('First fixture placement must be accepted.')
    const afterFirst = applyOnlineUpdate(initial, {
      status: 'accepted',
      matchId: descriptor.matchId,
      commandId: null,
      fromRevision: 0,
      toRevision: 1,
      actorSeat: 0,
      commands: [{ type: 'place', locationId: 0, symbol: 'rock' }],
      events: firstPlacement.events,
      turnTimeRemainingMs: 10_000,
    }, 2_000).state
    const finishingPlacement = applyCommand(afterFirst.canonical, 1, {
      type: 'place', locationId: 1, symbol: 'paper',
    })
    if (!finishingPlacement.accepted) {
      throw new Error('Finishing fixture placement must be accepted.')
    }
    const result = applyOnlineUpdate(afterFirst, {
      status: 'accepted',
      matchId: descriptor.matchId,
      commandId: null,
      fromRevision: 1,
      toRevision: 2,
      actorSeat: 1,
      commands: [{ type: 'place', locationId: 1, symbol: 'paper' }],
      events: finishingPlacement.events,
      turnTimeRemainingMs: 10_000,
    }, 3_000)

    expect(finishingPlacement.state.phase).toBe('finished')
    expect(result.state.status).toBe('sync-lost')
  })

  it('converges an actor single update with an opponent extra-turn batch', () => {
    let actor = createOnlineAuthority(descriptor, 17, 17, 1_000)
    let opponent = createOnlineAuthority(descriptor, 17, 21, 1_000)
    let server = createGame({
      mode: descriptor.mode,
      rules: descriptor.rules,
      seed: descriptor.seed,
      firstSeat: descriptor.firstSeat,
    })
    let revision = 0

    const serverAccept = (seat: Seat, commands: GameCommand[]): AcceptedGameUpdate => {
      const fromRevision = revision
      const events: DomainEvent[] = []
      for (const command of commands) {
        const result = applyCommand(server, seat, command)
        if (!result.accepted) throw new Error('Server fixture command was rejected.')
        server = result.state
        events.push(...result.events)
        revision += 1
      }
      return {
        status: 'accepted',
        matchId: descriptor.matchId,
        commandId: null,
        fromRevision,
        toRevision: revision,
        actorSeat: seat,
        commands,
        events,
        turnTimeRemainingMs: 9_000,
      }
    }
    const broadcast = (seat: Seat, command: GameCommand) => {
      const update = serverAccept(seat, [command])
      actor = applyOnlineUpdate(actor, update, 2_000 + revision).state
      opponent = applyOnlineUpdate(opponent, update, 2_000 + revision).state
    }

    broadcast(0, { type: 'place', locationId: 0, symbol: 'scissors' })
    broadcast(1, { type: 'place', locationId: 3, symbol: 'rock' })
    broadcast(0, { type: 'place', locationId: 1, symbol: 'scissors' })
    broadcast(1, { type: 'place', locationId: 4, symbol: 'rock' })
    broadcast(0, { type: 'place', locationId: 2, symbol: 'scissors' })
    broadcast(1, { type: 'place', locationId: 5, symbol: 'rock' })
    broadcast(0, { type: 'activate-powerup', powerup: 'extraTurn' })

    const firstCommand = { type: 'place', locationId: 6, symbol: 'paper' } as const
    const queuedFirst = queueOnlineCommand(actor, firstCommand)
    actor = queuedFirst.state
    const firstUpdate = serverAccept(0, [firstCommand])
    actor = applyOnlineUpdate(actor, { ...firstUpdate, commandId: 0 }, 3_000).state
    expect(actor.revision).toBe(8)
    expect(opponent.revision).toBe(7)

    const secondCommand = { type: 'place', locationId: 7, symbol: 'paper' } as const
    const queuedSecond = queueOnlineCommand(actor, secondCommand)
    actor = queuedSecond.state
    const secondUpdate = serverAccept(0, [secondCommand])
    actor = applyOnlineUpdate(actor, { ...secondUpdate, commandId: 1 }, 4_000).state
    opponent = applyOnlineUpdate(opponent, {
      ...secondUpdate,
      fromRevision: firstUpdate.fromRevision,
      commands: [...firstUpdate.commands, ...secondUpdate.commands],
      events: [...firstUpdate.events, ...secondUpdate.events],
    }, 4_000).state

    expect(actor.status).toBe('synchronized')
    expect(opponent.status).toBe('synchronized')
    expect(actor.revision).toBe(9)
    expect(opponent.revision).toBe(9)
    expect(actor.canonical).toEqual(opponent.canonical)
    expect(actor.canonical).toEqual(server)
  })

  it('clears a synchronized rejection with a stable explanation', () => {
    const queued = queueOnlineCommand(
      createOnlineAuthority(descriptor, 17, 17, 1_000),
      { type: 'place', locationId: 0, symbol: 'paper' },
    ).state
    const result = applyOnlineUpdate(queued, {
      status: 'rejected',
      matchId: 'match-1',
      commandId: 0,
      currentRevision: 0,
      reason: 'location-occupied',
    }, 2_000)

    expect(result.state.status).toBe('synchronized')
    expect(result.state.pending).toBeNull()
    expect(result.message).toBe('That spot is already occupied.')
  })

  it.each([
    ['wrong match', { ...accepted(0, 0, [], []), matchId: 'other' }],
    ['revision gap', accepted(1, 0, [], [])],
    ['malformed range', { ...accepted(0, 0, [], []), toRevision: 2 }],
    ['replay failure', accepted(0, 1, [{ type: 'place', locationId: 0, symbol: 'rock' }], [])],
  ])('fails closed on %s', (_label, update) => {
    const result = applyOnlineUpdate(
      createOnlineAuthority(descriptor, 17, 17, 1_000),
      update as OnlineGameUpdate,
      2_000,
    )
    expect(result.state.status).toBe('sync-lost')
  })

  it('locally elapses online time for display without changing canonical state', () => {
    const state = createOnlineAuthority(descriptor, 17, 17, 1_000)
    expect(getDisplayedTurnTimeMs(state, 4_000)).toBe(7_000)
    expect(getDisplayedTurnTimeMs(state, 20_000)).toBe(0)
    expect(state.revision).toBe(0)
    expect(state.canonical.turnCount).toBe(0)
  })

  it('still displays a full two-second first window after the visible countdown', () => {
    const state = createOnlineAuthority({
      ...descriptor,
      rules: { ...descriptor.rules, turnSeconds: 2 },
      turnTimeRemainingMs: 5_000,
    }, 17, 17, 1_000)

    expect(getDisplayedTurnTimeMs(state, 3_620)).toBe(2_380)
    expect(getDisplayedTurnTimeMs(state, 3_620)).toBeGreaterThanOrEqual(2_000)
    expect(state.canonical.turnCount).toBe(0)
  })
})
