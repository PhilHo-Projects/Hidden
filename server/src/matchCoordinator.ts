import {
  applyCommand,
  applyTimeout,
  clampGameConfig,
  createGame,
  DEFAULT_GAME_CONFIG,
  ENGINE_ID,
  ENGINE_REVISION,
  type DomainEvent,
  type EngineRef,
  type GameCommand,
  type GameConfig,
  type GameState,
  type ResolvedGameSpec,
  type Seat,
} from '@hidden/game-core'
import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import type {
  AcceptedGameUpdate,
  GameCommandEnvelope,
  GameUpdate,
  GameUpdateRejectionReason,
} from './protocol'

// The browser's visible 3-2-1-GO launch lasts 2.62 seconds. The first server
// deadline includes this fixed transport/presentation grace; every reset after
// an accepted placement remains exactly the configured placement window.
export const MATCH_START_GRACE_MS = 3_000

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

interface CachedCommand {
  readonly actorDelivery: GameUpdateDelivery
  readonly fingerprint: string
}

interface BufferedOpponentUpdate {
  readonly actorSeat: Seat
  readonly commands: GameCommand[]
  readonly events: DomainEvent[]
  readonly fromRevision: number
  toRevision: number
}

export interface MatchRun {
  deadline: number
  readonly id: string
  phase: MatchLifecyclePhase
  revision: number
  readonly spec: ResolvedGameSpec
  state: GameState
  readonly commandCaches: readonly [
    Map<number, CachedCommand>,
    Map<number, CachedCommand>,
  ]
  readonly acceptedCommandIds: readonly [Set<number>, Set<number>]
  bufferedOpponentUpdate: BufferedOpponentUpdate | undefined
}

export interface MatchRoom {
  readonly id: string
  readonly participants: readonly [
    TrustedMatchParticipant,
    TrustedMatchParticipant,
  ]
  phase: MatchLifecyclePhase
  readonly readySeats: Set<Seat>
  readonly config: GameConfig
  currentRun: MatchRun | undefined
}

export interface RoomFactoryInput {
  readonly id: string
  readonly participants: readonly [
    TrustedMatchParticipant,
    TrustedMatchParticipant,
  ]
  readonly config: GameConfig
}

export type MatchRoomFactory = (input: RoomFactoryInput) => MatchRoom

export interface GameStartDescriptor {
  readonly matchId: string
  readonly engine: EngineRef
  readonly config: GameConfig
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

export interface GameUpdateDelivery {
  readonly connectionId: number
  readonly update: GameUpdate
}

export interface MatchCoordinatorDependencies {
  readonly createUuid: () => string
  readonly createSeed: () => number
  readonly chooseFirstSeat: () => Seat
  readonly now: () => number
  readonly scheduleTimeout: (callback: () => void, delayMs: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
  readonly commandCacheSize: number
  readonly createJoinCode: () => string
  readonly deliverySink: (deliveries: readonly GameUpdateDelivery[]) => void
  readonly onDeadline?: (room: MatchRoom, run: MatchRun) => void
  readonly roomFactory?: MatchRoomFactory
}

interface QuickMatchEntry {
  readonly participant: QuickMatchParticipant
  readonly proposedConfig: GameConfig | undefined
}

export interface PendingGame {
  readonly code: string
  readonly host: QuickMatchParticipant
  readonly config: GameConfig
  readonly isPrivate: boolean
  readonly createdAt: number
}

export interface PublicGameSummary {
  readonly code: string
  readonly hostName: string
  readonly config: GameConfig
}

export type LobbyErrorReason =
  | 'not-found'
  | 'already-hosting'
  | 'already-in-match'
  | 'own-game'

// Ambiguous glyphs are omitted so a code read aloud or off a phone screen is
// unambiguous: no O/0, no I/1.
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function defaultCreateJoinCode() {
  let code = ''
  for (let index = 0; index < 5; index += 1) {
    code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)]
  }
  return code
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

function freezeConfig(config: GameConfig): GameConfig {
  return Object.freeze({ ...config })
}

function freezeSpec(spec: ResolvedGameSpec): ResolvedGameSpec {
  return Object.freeze({
    ...spec,
    engine: Object.freeze({ ...spec.engine }),
  })
}

export function createMatchRoom(input: RoomFactoryInput): MatchRoom {
  return {
    id: input.id,
    participants: input.participants,
    phase: 'ready',
    readySeats: new Set(),
    config: input.config,
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
  commandCacheSize: 128,
  createJoinCode: defaultCreateJoinCode,
  deliverySink: () => undefined,
}

export class MatchCoordinator {
  private readonly dependencies: MatchCoordinatorDependencies
  private readonly matchmakingQueue = new Map<number, QuickMatchEntry>()
  private readonly pendingGames = new Map<string, PendingGame>()
  private readonly pendingCodeByConnectionId = new Map<number, string>()
  private readonly roomByConnectionId = new Map<number, MatchRoom>()
  private readonly roomsById = new Map<string, MatchRoom>()
  private readonly timerByRoomId = new Map<string, unknown>()
  private readonly deliverySubscribers = new Set<
    (deliveries: readonly GameUpdateDelivery[]) => void
  >()

  constructor(dependencies: Partial<MatchCoordinatorDependencies> = {}) {
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies }
  }

  enqueueQuickMatch(
    participant: QuickMatchParticipant,
    proposedConfig?: GameConfig,
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
      proposedConfig: proposedConfig
        ? freezeConfig(clampGameConfig(proposedConfig))
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
      first.proposedConfig ?? second.proposedConfig,
    )
  }

  cancelQuickMatch(connectionId: number) {
    this.matchmakingQueue.delete(connectionId)
  }

  createPendingGame(
    host: QuickMatchParticipant,
    config: GameConfig,
    isPrivate: boolean,
  ): PendingGame | { readonly error: LobbyErrorReason } {
    if (this.roomByConnectionId.has(host.connectionId)) {
      return { error: 'already-in-match' }
    }
    if (this.pendingCodeByConnectionId.has(host.connectionId)) {
      return { error: 'already-hosting' }
    }

    // Hosting and queueing at once would let one connection be pulled into two
    // rooms, so creating a game leaves the Quick Match queue.
    this.matchmakingQueue.delete(host.connectionId)

    let code = this.dependencies.createJoinCode()
    while (this.pendingGames.has(code)) {
      code = this.dependencies.createJoinCode()
    }

    const pending: PendingGame = Object.freeze({
      code,
      host: Object.freeze({
        ...(host.accountId ? { accountId: host.accountId } : {}),
        connectionId: host.connectionId,
        username: host.username,
      }),
      config: freezeConfig(clampGameConfig(config)),
      isPrivate,
      createdAt: this.dependencies.now(),
    })
    this.pendingGames.set(code, pending)
    this.pendingCodeByConnectionId.set(host.connectionId, code)
    return pending
  }

  listPublicGames(): PublicGameSummary[] {
    return [...this.pendingGames.values()]
      .filter((pending) => !pending.isPrivate)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((pending) => ({
        code: pending.code,
        hostName: pending.host.username,
        config: pending.config,
      }))
  }

  getPendingGame(code: string) {
    return this.pendingGames.get(code)
  }

  joinPendingGame(
    code: string,
    joiner: QuickMatchParticipant,
  ): MatchRoom | { readonly error: LobbyErrorReason } {
    const pending = this.pendingGames.get(code)
    if (!pending) {
      return { error: 'not-found' }
    }
    if (pending.host.connectionId === joiner.connectionId) {
      return { error: 'own-game' }
    }
    if (this.roomByConnectionId.has(joiner.connectionId)) {
      return { error: 'already-in-match' }
    }

    this.pendingGames.delete(code)
    this.pendingCodeByConnectionId.delete(pending.host.connectionId)
    this.matchmakingQueue.delete(joiner.connectionId)
    return this.createRoom([pending.host, joiner], pending.config)
  }

  cancelPendingGame(connectionId: number) {
    const code = this.pendingCodeByConnectionId.get(connectionId)
    if (code === undefined) {
      return false
    }
    this.pendingGames.delete(code)
    this.pendingCodeByConnectionId.delete(connectionId)
    return true
  }

  createRoom(
    participants: readonly [QuickMatchParticipant, QuickMatchParticipant],
    proposedConfig: GameConfig = DEFAULT_GAME_CONFIG,
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
      config: freezeConfig(clampGameConfig(proposedConfig)),
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

  subscribeDeliveries(
    subscriber: (deliveries: readonly GameUpdateDelivery[]) => void,
  ) {
    this.deliverySubscribers.add(subscriber)
    return () => this.deliverySubscribers.delete(subscriber)
  }

  setReady(connectionId: number, ready: boolean): ReadyTransition {
    const room = this.roomByConnectionId.get(connectionId)
    const participant = room?.participants.find(
      (candidate) => candidate.connectionId === connectionId,
    )
    if (!room || !participant || room.phase === 'abandoned') {
      throw new Error('Connection is not a member of an active room.')
    }

    const transition: ReadyTransition = {
      opponentConnectionIds: this.getOpponentConnectionIds(connectionId),
      ready,
      room,
    }
    if (room.phase === 'active') {
      return { ...transition, opponentConnectionIds: [] }
    }

    if (ready) {
      room.readySeats.add(participant.seat)
    } else {
      room.readySeats.delete(participant.seat)
    }
    if (room.readySeats.size < room.participants.length) {
      return transition
    }

    return { ...transition, start: this.startRun(room) }
  }

  handleGameCommand(
    connectionId: number,
    envelope: GameCommandEnvelope,
  ): GameUpdateDelivery[] {
    const room = this.roomByConnectionId.get(connectionId)
    const timeoutDeliveries = room ? this.resolveExpiredDeadline(room) : []
    const run = room?.currentRun
    const participant = room?.participants.find(
      (candidate) => candidate.connectionId === connectionId,
    )

    if (!room || !run || !participant || room.phase === 'abandoned') {
      return [
        ...timeoutDeliveries,
        this.rejection(
          connectionId,
          envelope.matchId,
          envelope.commandId,
          0,
          'no-active-match',
        ),
      ]
    }
    if (envelope.matchId !== run.id) {
      return [
        ...timeoutDeliveries,
        this.rejection(
          connectionId,
          run.id,
          envelope.commandId,
          run.revision,
          'wrong-match',
        ),
      ]
    }

    const cache = run.commandCaches[participant.seat]
    const fingerprint = this.commandFingerprint(envelope)
    const cached = cache.get(envelope.commandId)
    if (cached?.fingerprint === fingerprint) {
      if (timeoutDeliveries.length === 0) {
        return [cached.actorDelivery]
      }
      return [
        ...timeoutDeliveries,
        this.rejection(
          connectionId,
          run.id,
          envelope.commandId,
          run.revision,
          run.phase === 'finished' ? 'game-finished' : 'stale-revision',
        ),
      ]
    }
    if (run.phase === 'finished' || room.phase === 'finished') {
      return [
        ...timeoutDeliveries,
        this.rejection(
          connectionId,
          run.id,
          envelope.commandId,
          run.revision,
          'game-finished',
        ),
      ]
    }
    if (cached) {
      return [
        ...timeoutDeliveries,
        this.rejection(
          connectionId,
          run.id,
          envelope.commandId,
          run.revision,
          'command-id-reused',
        ),
      ]
    }
    if (run.acceptedCommandIds[participant.seat].has(envelope.commandId)) {
      return [
        ...timeoutDeliveries,
        this.rejection(
          connectionId,
          run.id,
          envelope.commandId,
          run.revision,
          'command-id-reused',
        ),
      ]
    }
    if (envelope.expectedRevision !== run.revision) {
      return [
        ...timeoutDeliveries,
        this.rejection(
          connectionId,
          run.id,
          envelope.commandId,
          run.revision,
          'stale-revision',
        ),
      ]
    }
    if (!envelope.command) {
      return [
        ...timeoutDeliveries,
        this.rejection(
          connectionId,
          run.id,
          envelope.commandId,
          run.revision,
          'invalid-command',
        ),
      ]
    }

    const result = applyCommand(run.state, participant.seat, envelope.command)
    if (!result.accepted) {
      return [
        ...timeoutDeliveries,
        this.rejection(
          connectionId,
          run.id,
          envelope.commandId,
          run.revision,
          result.rejection?.reason ?? 'invalid-command',
        ),
      ]
    }

    const deliveries = this.acceptClientCommand(
      room,
      run,
      participant.seat,
      envelope.commandId,
      envelope.command,
      result.state,
      [...result.events],
    )
    const actorDelivery = deliveries.find(
      (delivery) => delivery.connectionId === connectionId,
    )!
    cache.set(envelope.commandId, { actorDelivery, fingerprint })
    // Classic runs accept at most maxTurns + 10 client commands (one extra
    // placement and four power-up actions per seat), so match-lifetime ID
    // tombstones remain bounded while full cached responses can be capped.
    run.acceptedCommandIds[participant.seat].add(envelope.commandId)
    while (cache.size > Math.max(1, this.dependencies.commandCacheSize)) {
      const oldest = cache.keys().next().value as number | undefined
      if (oldest === undefined) break
      cache.delete(oldest)
    }
    return [...timeoutDeliveries, ...deliveries]
  }

  rejectLegacyGameplay(connectionId: number): GameUpdateDelivery[] {
    const room = this.roomByConnectionId.get(connectionId)
    const run = room?.currentRun
    if (!room || !run || room.phase === 'abandoned') {
      return []
    }
    return [
      this.rejection(
        connectionId,
        run.id,
        null,
        run.revision,
        'legacy-gameplay-disabled',
      ),
    ]
  }

  abandon(connectionId: number): AbandonedRoom | undefined {
    this.cancelQuickMatch(connectionId)
    // A host that drops must not leave an unjoinable game in the list.
    this.cancelPendingGame(connectionId)
    const room = this.roomByConnectionId.get(connectionId)
    if (!room) {
      return undefined
    }

    this.clearRoomTimer(room)
    room.phase = 'abandoned'
    if (room.currentRun) {
      room.currentRun.phase = 'abandoned'
      room.currentRun.bufferedOpponentUpdate = undefined
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

  private acceptClientCommand(
    room: MatchRoom,
    run: MatchRun,
    actorSeat: Seat,
    commandId: number,
    command: Exclude<GameCommand, { type: 'timeout' }>,
    state: GameState,
    events: DomainEvent[],
  ) {
    const fromRevision = run.revision
    run.state = state
    run.revision += 1

    if (state.phase === 'finished') {
      this.finishRun(room, run)
    } else if (command.type === 'place') {
      this.resetPlacementWindow(room, run)
    }

    const actorUpdate = this.acceptedUpdate(
      run,
      commandId,
      fromRevision,
      run.revision,
      actorSeat,
      [command],
      events,
    )
    const actorDelivery: GameUpdateDelivery = {
      connectionId: room.participants[actorSeat].connectionId,
      update: actorUpdate,
    }

    if (run.bufferedOpponentUpdate) {
      const buffered = run.bufferedOpponentUpdate
      buffered.commands.push(command)
      buffered.events.push(...events)
      buffered.toRevision = run.revision
      if (state.powerups[actorSeat].extraTurnInProgress) {
        return [actorDelivery]
      }
      run.bufferedOpponentUpdate = undefined
      return [
        actorDelivery,
        this.opponentDelivery(
          room,
          actorSeat,
          this.acceptedUpdate(
            run,
            null,
            buffered.fromRevision,
            buffered.toRevision,
            buffered.actorSeat,
            buffered.commands,
            buffered.events,
          ),
        ),
      ]
    }

    if (
      command.type === 'place' &&
      state.powerups[actorSeat].extraTurnInProgress
    ) {
      run.bufferedOpponentUpdate = {
        actorSeat,
        commands: [command],
        events: [...events],
        fromRevision,
        toRevision: run.revision,
      }
      return [actorDelivery]
    }

    return [
      actorDelivery,
      this.opponentDelivery(
        room,
        actorSeat,
        { ...actorUpdate, commandId: null },
      ),
    ]
  }

  private resolveExpiredDeadline(room: MatchRoom) {
    const run = room.currentRun
    if (
      !run ||
      run.phase !== 'active' ||
      room.phase !== 'active' ||
      this.dependencies.now() < run.deadline
    ) {
      return []
    }

    const handle = this.timerByRoomId.get(room.id)
    if (handle !== undefined) {
      this.timerByRoomId.delete(room.id)
      this.dependencies.clearTimeout(handle)
    }
    return this.resolveTimeout(room, run)
  }

  private resolveTimeout(room: MatchRoom, run: MatchRun) {
    if (
      this.roomsById.get(room.id) !== room ||
      room.currentRun !== run ||
      room.phase !== 'active' ||
      run.phase !== 'active'
    ) {
      return []
    }

    const actorSeat = run.state.activeSeat
    const fromRevision = run.revision
    const result = applyTimeout(run.state)
    if (!result.accepted) {
      return []
    }
    run.state = result.state
    run.revision += 1
    if (run.state.phase === 'finished') {
      this.finishRun(room, run)
    } else {
      this.resetPlacementWindow(room, run)
    }

    const timeoutCommand = { type: 'timeout' } as const
    const update = this.acceptedUpdate(
      run,
      null,
      fromRevision,
      run.revision,
      actorSeat,
      [timeoutCommand],
      [...result.events],
    )
    const actorDelivery: GameUpdateDelivery = {
      connectionId: room.participants[actorSeat].connectionId,
      update,
    }
    if (run.bufferedOpponentUpdate) {
      const buffered = run.bufferedOpponentUpdate
      buffered.commands.push(timeoutCommand)
      buffered.events.push(...result.events)
      buffered.toRevision = run.revision
      run.bufferedOpponentUpdate = undefined
      return [
        actorDelivery,
        this.opponentDelivery(
          room,
          actorSeat,
          this.acceptedUpdate(
            run,
            null,
            buffered.fromRevision,
            buffered.toRevision,
            buffered.actorSeat,
            buffered.commands,
            buffered.events,
          ),
        ),
      ]
    }
    if (run.state.powerups[actorSeat].extraTurnInProgress) {
      run.bufferedOpponentUpdate = {
        actorSeat,
        commands: [timeoutCommand],
        events: [...result.events],
        fromRevision,
        toRevision: run.revision,
      }
      return [actorDelivery]
    }
    return [
      actorDelivery,
      this.opponentDelivery(room, actorSeat, update),
    ]
  }

  private acceptedUpdate(
    run: MatchRun,
    commandId: number | null,
    fromRevision: number,
    toRevision: number,
    actorSeat: Seat,
    commands: readonly GameCommand[],
    events: readonly DomainEvent[],
  ): AcceptedGameUpdate {
    return {
      status: 'accepted',
      matchId: run.id,
      commandId,
      fromRevision,
      toRevision,
      actorSeat,
      commands,
      events,
      turnTimeRemainingMs:
        run.phase === 'active'
          ? Math.max(0, run.deadline - this.dependencies.now())
          : null,
    }
  }

  private opponentDelivery(
    room: MatchRoom,
    actorSeat: Seat,
    update: AcceptedGameUpdate,
  ): GameUpdateDelivery {
    return {
      connectionId: room.participants[(1 - actorSeat) as Seat].connectionId,
      update,
    }
  }

  private rejection(
    connectionId: number,
    matchId: string,
    commandId: number | null,
    currentRevision: number,
    reason: GameUpdateRejectionReason,
  ): GameUpdateDelivery {
    return {
      connectionId,
      update: {
        status: 'rejected',
        matchId,
        commandId,
        currentRevision,
        reason,
      },
    }
  }

  private commandFingerprint(envelope: GameCommandEnvelope) {
    return JSON.stringify({
      matchId: envelope.matchId,
      expectedRevision: envelope.expectedRevision,
      command: envelope.command,
    })
  }

  private finishRun(room: MatchRoom, run: MatchRun) {
    this.clearRoomTimer(room)
    run.phase = 'finished'
    room.phase = 'finished'
  }

  private startRun(room: MatchRoom): MatchStart {
    if (room.currentRun) {
      this.clearRoomTimer(room)
      room.currentRun.phase = 'finished'
      room.currentRun.bufferedOpponentUpdate = undefined
    }

    const startedAt = this.dependencies.now()
    const turnTimeRemainingMs =
      MATCH_START_GRACE_MS + room.config.turnSeconds * 1_000
    const spec = freezeSpec({
      engine: { id: ENGINE_ID, revision: ENGINE_REVISION },
      config: room.config,
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
      commandCaches: [new Map(), new Map()],
      acceptedCommandIds: [new Set(), new Set()],
      bufferedOpponentUpdate: undefined,
    }
    room.currentRun = run
    room.phase = 'active'
    room.readySeats.clear()
    this.scheduleRunTimer(room, run, turnTimeRemainingMs)

    const firstConnectionId = room.participants.find(
      (participant) => participant.seat === spec.firstSeat,
    )!.connectionId
    const descriptor: GameStartDescriptor = Object.freeze({
      matchId: run.id,
      engine: spec.engine,
      config: spec.config,
      seed: spec.seed,
      firstSeat: spec.firstSeat,
      revision: 0,
      turnTimeRemainingMs,
    })

    return { descriptor, firstConnectionId, room, run }
  }

  private resetPlacementWindow(room: MatchRoom, run: MatchRun) {
    this.clearRoomTimer(room)
    const duration = room.config.turnSeconds * 1_000
    run.deadline = this.dependencies.now() + duration
    this.scheduleRunTimer(room, run, duration)
  }

  private scheduleRunTimer(room: MatchRoom, run: MatchRun, delayMs: number) {
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
      this.timerByRoomId.delete(room.id)
      const deliveries = this.resolveTimeout(room, run)
      this.dependencies.onDeadline?.(room, run)
      if (deliveries.length > 0) {
        this.dependencies.deliverySink(deliveries)
        for (const subscriber of this.deliverySubscribers) {
          subscriber(deliveries)
        }
      }
    }, delayMs)
    this.timerByRoomId.set(room.id, handle)
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
