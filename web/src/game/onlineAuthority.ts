import {
  applyCommand,
  applyTimeout,
  createGame,
  type DomainEvent,
  type GameCommand,
  type GameState,
  type Seat,
} from '@hidden/game-core'
import type {
  ClientGameCommand,
  GameCommandEnvelope,
  GameStartDescriptor,
  GameUpdate,
  GameUpdateRejectionReason,
} from './protocol'

export type OnlineGameUpdate = GameUpdate

export interface PendingOnlineCommand {
  readonly commandId: number
  readonly command: ClientGameCommand
}

export interface OnlineAuthorityState {
  readonly status: 'synchronized' | 'sync-lost'
  readonly syncLostReason: string | null
  readonly matchId: string
  readonly localSeat: Seat
  readonly canonical: GameState
  readonly revision: number
  readonly nextCommandId: number
  readonly pending: PendingOnlineCommand | null
  readonly turnTimeRemainingMs: number | null
  readonly turnTimeObservedAtMs: number
}

export interface QueueOnlineCommandResult {
  readonly state: OnlineAuthorityState
  readonly envelope: GameCommandEnvelope | null
}

export interface ApplyOnlineUpdateResult {
  readonly state: OnlineAuthorityState
  readonly events: readonly DomainEvent[]
  readonly message?: string
  readonly acceptedCommand?: ClientGameCommand
  readonly clearLocalSelection?: boolean
}

function otherSeat(seat: Seat): Seat {
  return (1 - seat) as Seat
}

function syncLost(
  state: OnlineAuthorityState,
  reason: string,
): ApplyOnlineUpdateResult {
  return {
    state: {
      ...state,
      status: 'sync-lost',
      syncLostReason: reason,
      pending: null,
    },
    events: [],
  }
}

function sameWireValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

const REJECTION_MESSAGES: Record<GameUpdateRejectionReason, string> = {
  'invalid-command': 'That action is invalid.',
  'not-active-seat': 'It is not your turn.',
  'game-finished': 'This match has already finished.',
  'unknown-location': 'That board location does not exist.',
  'location-occupied': 'That spot is already occupied.',
  'powerup-locked': 'That power-up is still locked.',
  'powerup-used': 'That power-up has already been used.',
  'shield-selection-pending': 'Choose a shield target first.',
  'shield-selection-not-pending': 'Shield targeting is not active.',
  'invalid-shield-target': 'Only one of your pieces can be shielded.',
  'desecrated-location': 'That tile is desecrated. It reopens on your next turn.',
  'no-active-match': 'This match is no longer active.',
  'wrong-match': 'That action belongs to another match.',
  'stale-revision': 'The match changed before that action arrived.',
  'command-id-reused': 'That action was already submitted differently.',
  'legacy-gameplay-disabled': 'This client action is no longer supported.',
}

export function createOnlineAuthority(
  descriptor: GameStartDescriptor,
  firstPlayerId: number,
  localClientId: number,
  observedAtMs: number,
): OnlineAuthorityState {
  const localSeat = firstPlayerId === localClientId
    ? descriptor.firstSeat
    : otherSeat(descriptor.firstSeat)
  return {
    status: 'synchronized',
    syncLostReason: null,
    matchId: descriptor.matchId,
    localSeat,
    canonical: createGame({
      engine: descriptor.engine,
      config: descriptor.config,
      seed: descriptor.seed,
      firstSeat: descriptor.firstSeat,
    }),
    revision: descriptor.revision,
    nextCommandId: 0,
    pending: null,
    turnTimeRemainingMs: descriptor.turnTimeRemainingMs,
    turnTimeObservedAtMs: observedAtMs,
  }
}

export function queueOnlineCommand(
  state: OnlineAuthorityState,
  command: ClientGameCommand,
): QueueOnlineCommandResult {
  if (
    state.status !== 'synchronized' ||
    state.pending ||
    state.canonical.phase !== 'active' ||
    state.canonical.activeSeat !== state.localSeat ||
    (command as GameCommand).type === 'timeout'
  ) {
    return { state, envelope: null }
  }
  const envelope: GameCommandEnvelope = {
    matchId: state.matchId,
    commandId: state.nextCommandId,
    expectedRevision: state.revision,
    command,
  }
  return {
    state: {
      ...state,
      nextCommandId: state.nextCommandId + 1,
      pending: { commandId: envelope.commandId, command },
    },
    envelope,
  }
}

export function applyOnlineUpdate(
  state: OnlineAuthorityState,
  update: OnlineGameUpdate,
  observedAtMs: number,
): ApplyOnlineUpdateResult {
  if (state.status === 'sync-lost') return { state, events: [] }
  if (update.matchId !== state.matchId) {
    return syncLost(state, 'The server update belongs to another match.')
  }

  if (update.status === 'rejected') {
    if (update.currentRevision !== state.revision) {
      return syncLost(state, 'The server revision no longer matches this client.')
    }
    if (
      update.commandId !== null &&
      (!state.pending || state.pending.commandId !== update.commandId)
    ) {
      return syncLost(state, 'The server rejected an unknown pending action.')
    }
    return {
      state: { ...state, pending: null },
      events: [],
      message: REJECTION_MESSAGES[update.reason],
    }
  }

  if (update.fromRevision !== state.revision) {
    return syncLost(state, 'An authoritative update revision was missed.')
  }
  if (
    update.commands.length < 1 ||
    update.toRevision !== update.fromRevision + update.commands.length
  ) {
    return syncLost(state, 'The authoritative update revision range is invalid.')
  }
  if (
    update.commandId !== null &&
    (!state.pending || state.pending.commandId !== update.commandId)
  ) {
    return syncLost(state, 'The server accepted an unknown pending action.')
  }
  if (update.commandId !== null && update.actorSeat !== state.localSeat) {
    return syncLost(state, 'The server attributed a local action to another seat.')
  }
  if (
    update.commandId !== null &&
    !sameWireValue(state.pending?.command, update.commands.at(-1))
  ) {
    return syncLost(state, 'The accepted action does not match the pending action.')
  }

  let canonical = state.canonical
  const replayedEvents: DomainEvent[] = []
  for (const command of update.commands) {
    if (canonical.activeSeat !== update.actorSeat) {
      return syncLost(state, 'The authoritative actor cannot apply this update.')
    }
    const result = command.type === 'timeout'
      ? applyTimeout(canonical)
      : applyCommand(canonical, update.actorSeat, command)
    if (!result.accepted) {
      return syncLost(state, 'The authoritative command cannot be replayed.')
    }
    canonical = result.state
    replayedEvents.push(...result.events)
  }
  if (!sameWireValue(replayedEvents, update.events)) {
    return syncLost(state, 'The authoritative effects do not match deterministic replay.')
  }
  if (
    (canonical.phase === 'active' && update.turnTimeRemainingMs === null) ||
    (canonical.phase === 'finished' && update.turnTimeRemainingMs !== null)
  ) {
    return syncLost(state, 'The authoritative deadline does not match the replayed phase.')
  }

  const acceptedCommand = update.commandId === null
    ? undefined
    : state.pending?.command
  return {
    state: {
      ...state,
      canonical,
      revision: update.toRevision,
      pending: update.commandId === null ? state.pending : null,
      turnTimeRemainingMs: update.turnTimeRemainingMs,
      turnTimeObservedAtMs: observedAtMs,
    },
    events: update.events,
    clearLocalSelection:
      (acceptedCommand?.type === 'place') ||
      (update.actorSeat === state.localSeat &&
        update.commands.some((command) => command.type === 'timeout')),
    ...(acceptedCommand ? { acceptedCommand } : {}),
  }
}

export function getDisplayedTurnTimeMs(
  state: OnlineAuthorityState,
  nowMs: number,
) {
  if (state.turnTimeRemainingMs === null) return 0
  return Math.max(
    0,
    state.turnTimeRemainingMs - Math.max(0, nowMs - state.turnTimeObservedAtMs),
  )
}
