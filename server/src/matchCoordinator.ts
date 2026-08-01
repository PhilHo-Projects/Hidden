import {
  clampMatchRules,
  createGame,
  DEFAULT_MATCH_RULES,
  type GameSpec,
  type GameState,
  type MatchRules,
  type ModeRef,
  type Seat,
} from '@hidden/game-core'
import { randomBytes, randomInt, randomUUID } from 'node:crypto'

export type MatchLifecyclePhase =
  | 'ready'
  | 'active'
  | 'finished'
  | 'abandoned'

export interface QuickMatchParticipant {
  readonly accountId?: string
  readonly connectionId: number
  readonly username: string
}

export interface TrustedMatchParticipant {
  readonly accountId: string | undefined
  readonly connectionId: number
  readonly seat: Seat
  readonly username: string
}

export interface MatchRun {
  readonly deadline: number
  readonly id: string
  phase: MatchLifecyclePhase
  readonly revision: 0
  readonly spec: GameSpec
  readonly state: GameState
}

export interface MatchRoom {
  readonly id: string
  readonly participants: readonly [
    TrustedMatchParticipant,
    TrustedMatchParticipant,
  ]
  phase: MatchLifecyclePhase
  readonly readySeats: Set<Seat>
  readonly rules: MatchRules
  currentRun: MatchRun | undefined
}

export interface RoomFactoryInput {
  readonly id: string
  readonly participants: readonly [
    TrustedMatchParticipant,
    TrustedMatchParticipant,
  ]
  readonly rules: MatchRules
}

export type MatchRoomFactory = (input: RoomFactoryInput) => MatchRoom

export interface GameStartDescriptor {
  readonly matchId: string
  readonly mode: ModeRef
  readonly rules: MatchRules
  readonly seed: number
  readonly firstSeat: Seat
  readonly revision: 0
  readonly turnTimeRemainingMs: number
}

export interface MatchStart {
  readonly descriptor: GameStartDescriptor
  readonly firstConnectionId: number
  readonly room: MatchRoom
  readonly run: MatchRun
}

export interface ReadyTransition {
  readonly opponentConnectionIds: readonly number[]
  readonly ready: boolean
  readonly room: MatchRoom
  readonly start?: MatchStart
}

export interface AbandonedRoom {
  readonly remainingConnectionIds: readonly number[]
  readonly room: MatchRoom
  readonly roomId: string
}

export interface MatchCoordinatorDependencies {
  readonly createUuid: () => string
  readonly createSeed: () => number
  readonly chooseFirstSeat: () => Seat
  readonly now: () => number
  readonly scheduleTimeout: (callback: () => void, delayMs: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
  readonly onDeadline?: (room: MatchRoom, run: MatchRun) => void
  readonly roomFactory?: MatchRoomFactory
}

interface QuickMatchEntry {
  readonly participant: QuickMatchParticipant
  readonly proposedRules: MatchRules | undefined
}

function freezeParticipant(
  participant: QuickMatchParticipant,
  seat: Seat,
): TrustedMatchParticipant {
  return Object.freeze({
    accountId: participant.accountId,
    connectionId: participant.connectionId,
    seat,
    username: participant.username,
  })
}

function freezeRules(rules: MatchRules): MatchRules {
  return Object.freeze({ ...rules })
}

function freezeSpec(spec: GameSpec): GameSpec {
  return Object.freeze({
    ...spec,
    mode: Object.freeze({ ...spec.mode }),
    rules: spec.rules,
  })
}

export function createMatchRoom(input: RoomFactoryInput): MatchRoom {
  return {
    id: input.id,
    participants: input.participants,
    phase: 'ready',
    readySeats: new Set(),
    rules: input.rules,
    currentRun: undefined,
  }
}

function defaultScheduleTimeout(callback: () => void, delayMs: number) {
  const handle = setTimeout(callback, delayMs)
  handle.unref()
  return handle
}

const DEFAULT_DEPENDENCIES: MatchCoordinatorDependencies = {
  createUuid: randomUUID,
  createSeed: () => randomBytes(4).readUInt32BE(0),
  chooseFirstSeat: () => randomInt(2) as Seat,
  now: Date.now,
  scheduleTimeout: defaultScheduleTimeout,
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
}

export class MatchCoordinator {
  private readonly dependencies: MatchCoordinatorDependencies
  private readonly matchmakingQueue = new Map<number, QuickMatchEntry>()
  private readonly roomByConnectionId = new Map<number, MatchRoom>()
  private readonly roomsById = new Map<string, MatchRoom>()
  private readonly timerByRoomId = new Map<string, unknown>()

  constructor(dependencies: Partial<MatchCoordinatorDependencies> = {}) {
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies }
  }

  enqueueQuickMatch(
    participant: QuickMatchParticipant,
    proposedRules?: MatchRules,
  ): MatchRoom | undefined {
    if (this.roomByConnectionId.has(participant.connectionId)) {
      return undefined
    }

    const snapshot = Object.freeze({
      ...(participant.accountId ? { accountId: participant.accountId } : {}),
      connectionId: participant.connectionId,
      username: participant.username,
    })
    this.matchmakingQueue.set(participant.connectionId, {
      participant: snapshot,
      proposedRules: proposedRules
        ? freezeRules(clampMatchRules(proposedRules))
        : undefined,
    })

    if (this.matchmakingQueue.size < 2) {
      return undefined
    }

    const entries = [...this.matchmakingQueue.values()]
    const first = entries[0]!
    const second = entries[1]!
    this.matchmakingQueue.delete(first.participant.connectionId)
    this.matchmakingQueue.delete(second.participant.connectionId)
    return this.createRoom(
      [first.participant, second.participant],
      first.proposedRules ?? second.proposedRules,
    )
  }

  cancelQuickMatch(connectionId: number) {
    this.matchmakingQueue.delete(connectionId)
  }

  createRoom(
    participants: readonly [QuickMatchParticipant, QuickMatchParticipant],
    proposedRules: MatchRules = DEFAULT_MATCH_RULES,
  ): MatchRoom {
    const trustedParticipants = Object.freeze([
      freezeParticipant(participants[0], 0),
      freezeParticipant(participants[1], 1),
    ]) as unknown as readonly [
      TrustedMatchParticipant,
      TrustedMatchParticipant,
    ]
    const input: RoomFactoryInput = {
      id: this.dependencies.createUuid(),
      participants: trustedParticipants,
      rules: freezeRules(clampMatchRules(proposedRules)),
    }
    const room = (this.dependencies.roomFactory ?? createMatchRoom)(input)
    this.roomsById.set(room.id, room)
    for (const participant of room.participants) {
      this.roomByConnectionId.set(participant.connectionId, room)
    }
    return room
  }

  getRoomForConnection(connectionId: number) {
    return this.roomByConnectionId.get(connectionId)
  }

  getOpponentConnectionIds(connectionId: number) {
    const room = this.roomByConnectionId.get(connectionId)
    if (!room) {
      return []
    }
    return room.participants
      .filter((participant) => participant.connectionId !== connectionId)
      .map((participant) => participant.connectionId)
  }

  setReady(connectionId: number, ready: boolean): ReadyTransition {
    const room = this.roomByConnectionId.get(connectionId)
    const participant = room?.participants.find(
      (candidate) => candidate.connectionId === connectionId,
    )
    if (!room || !participant || room.phase === 'abandoned') {
      throw new Error('Connection is not a member of an active room.')
    }

    if (ready) {
      room.readySeats.add(participant.seat)
    } else {
      room.readySeats.delete(participant.seat)
    }

    const transition: ReadyTransition = {
      opponentConnectionIds: this.getOpponentConnectionIds(connectionId),
      ready,
      room,
    }
    if (room.readySeats.size < room.participants.length) {
      return transition
    }

    return { ...transition, start: this.startRun(room) }
  }

  abandon(connectionId: number): AbandonedRoom | undefined {
    this.cancelQuickMatch(connectionId)
    const room = this.roomByConnectionId.get(connectionId)
    if (!room) {
      return undefined
    }

    this.clearRoomTimer(room)
    room.phase = 'abandoned'
    if (room.currentRun) {
      room.currentRun.phase = 'abandoned'
    }
    room.readySeats.clear()
    this.roomsById.delete(room.id)
    for (const participant of room.participants) {
      this.roomByConnectionId.delete(participant.connectionId)
    }

    return {
      remainingConnectionIds: room.participants
        .filter((participant) => participant.connectionId !== connectionId)
        .map((participant) => participant.connectionId),
      room,
      roomId: room.id,
    }
  }

  private startRun(room: MatchRoom): MatchStart {
    if (room.currentRun) {
      this.clearRoomTimer(room)
      room.currentRun.phase = 'finished'
    }

    const startedAt = this.dependencies.now()
    const turnTimeRemainingMs = room.rules.turnSeconds * 1_000
    const spec = freezeSpec({
      mode: { id: 'classic', revision: 1 },
      rules: room.rules,
      seed: this.dependencies.createSeed() >>> 0,
      firstSeat: this.dependencies.chooseFirstSeat(),
    })
    const run: MatchRun = {
      deadline: startedAt + turnTimeRemainingMs,
      id: this.dependencies.createUuid(),
      phase: 'active',
      revision: 0,
      spec,
      state: createGame(spec),
    }
    room.currentRun = run
    room.phase = 'active'
    room.readySeats.clear()

    let handle: unknown
    handle = this.dependencies.scheduleTimeout(() => {
      const currentRoom = this.roomsById.get(room.id)
      if (
        currentRoom !== room ||
        room.currentRun !== run ||
        run.phase !== 'active' ||
        this.timerByRoomId.get(room.id) !== handle
      ) {
        return
      }
      this.dependencies.onDeadline?.(room, run)
    }, turnTimeRemainingMs)
    this.timerByRoomId.set(room.id, handle)

    const firstConnectionId = room.participants.find(
      (participant) => participant.seat === spec.firstSeat,
    )!.connectionId
    const descriptor: GameStartDescriptor = Object.freeze({
      matchId: run.id,
      mode: spec.mode,
      rules: spec.rules,
      seed: spec.seed,
      firstSeat: spec.firstSeat,
      revision: 0,
      turnTimeRemainingMs,
    })

    return { descriptor, firstConnectionId, room, run }
  }

  private clearRoomTimer(room: MatchRoom) {
    const handle = this.timerByRoomId.get(room.id)
    if (handle === undefined) {
      return
    }
    this.timerByRoomId.delete(room.id)
    this.dependencies.clearTimeout(handle)
  }
}
