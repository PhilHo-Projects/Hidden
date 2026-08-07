import { decode, encode } from '@msgpack/msgpack'
import type { QueuedMove } from './types'
import {
  clampGameConfig,
  DEFAULT_GAME_CONFIG,
  decodeGameConfig,
  ENGINE_ID,
  ENGINE_REVISION,
  type ClassicSymbol,
  type DomainEvent,
  type GameCommand,
  type GameConfig,
  type PowerupKey,
  type RejectionReason,
  type Seat,
} from '@hidden/game-core'

export const LOBBY_ROOM_ID = 'lobby'

// The legacy relay packets still name moves by colour on the wire. That naming
// is frozen into the protocol; only the decoded value became a symbol.
function decodeWireSymbol(value: unknown): ClassicSymbol {
  switch (value) {
    case 'green':
      return 'rock'
    case 'blue':
      return 'paper'
    case 'red':
      return 'scissors'
    default:
      throw new Error(`Unsupported wire color: ${String(value)}`)
  }
}

/*
 * Numbers are frozen: renaming a symbol is fine, renumbering one is a protocol
 * break. Append from 28. The three tiers below are not interchangeable.
 *
 * RESERVED   never implemented by this server, and nothing decodes them. They
 *            exist so the numbers stay claimed. Do not reuse them.
 * LEGACY     the pre-authoritative move relays. The server parses them only to
 *            answer `legacy-gameplay-disabled`, and the client still decodes
 *            them into an ignored no-op -- decoding must keep working, because
 *            NetworkClient turns a decode failure into a terminal sync-lost.
 * LIVE       everything the current protocol actually uses.
 */
export enum PacketType {
  /** RESERVED */
  CHAT = 0,
  /** RESERVED */
  POSITION = 1,
  ID_ASSIGN = 2,
  /** RESERVED */
  TIME_SYNC = 3,
  /** RESERVED */
  ROOM_CREATE = 4,
  ROOM_JOIN = 5,
  ROOM_LEAVE = 6,
  /** RESERVED */
  ROOM_DESTROY = 7,
  SERVER_RESPONSE = 8,
  USER_INFO = 9,
  /** LEGACY */
  GAME_MOVE = 10,
  /** LEGACY */
  IMMUNE_UPDATE = 11,
  READY_STATE = 12,
  MATCHMAKING_REQUEST = 13,
  MATCH_FOUND = 14,
  GAME_START = 15,
  // 16 was never assigned.
  OPPONENT_DISCONNECTED = 17,
  /** LEGACY */
  GAME_MOVES = 18,
  GAME_COMMAND = 19,
  GAME_UPDATE = 20,
  LOBBY_CREATE = 21,
  LOBBY_CREATED = 22,
  LOBBY_LIST = 23,
  LOBBY_JOIN = 24,
  LOBBY_CANCEL = 25,
  LOBBY_SUBSCRIBE = 26,
  LOBBY_ERROR = 27,
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

const LOBBY_ERROR_REASONS: readonly LobbyErrorReason[] = [
  'not-found',
  'already-hosting',
  'already-in-match',
  'own-game',
]

export interface UserEntry {
  userId: number
  userName: string
}

export interface GameStartDescriptor {
  readonly matchId: string
  readonly engine: { readonly id: typeof ENGINE_ID; readonly revision: number }
  readonly config: GameConfig
  readonly seed: number
  readonly firstSeat: Seat
  readonly revision: 0
  readonly turnTimeRemainingMs: number
}

export type ClientGameCommand = Exclude<GameCommand, { type: 'timeout' }>

export interface GameCommandEnvelope {
  readonly matchId: string
  readonly commandId: number
  readonly expectedRevision: number
  readonly command: ClientGameCommand
}

export type GameUpdateRejectionReason =
  | RejectionReason
  | 'no-active-match'
  | 'wrong-match'
  | 'stale-revision'
  | 'command-id-reused'
  | 'legacy-gameplay-disabled'

export interface AcceptedGameUpdate {
  readonly status: 'accepted'
  readonly matchId: string
  readonly commandId: number | null
  readonly fromRevision: number
  readonly toRevision: number
  readonly actorSeat: Seat
  readonly commands: readonly GameCommand[]
  readonly events: readonly DomainEvent[]
  readonly turnTimeRemainingMs: number | null
}

export interface RejectedGameUpdate {
  readonly status: 'rejected'
  readonly matchId: string
  readonly commandId: number | null
  readonly currentRevision: number
  readonly reason: GameUpdateRejectionReason
}

export type GameUpdate = AcceptedGameUpdate | RejectedGameUpdate

export type DecodedPacket =
  | { type: PacketType.ID_ASSIGN; clientId: number }
  | { type: PacketType.SERVER_RESPONSE; success: boolean; originalPacketType?: PacketType }
  | { type: PacketType.USER_INFO; users: UserEntry[] }
  | { type: PacketType.MATCH_FOUND; roomId: string; config: GameConfig }
  | {
      type: PacketType.GAME_START
      firstPlayerId: number
      descriptor: GameStartDescriptor
    }
  | { type: PacketType.GAME_MOVE; senderId: number; index: number; symbol: ClassicSymbol }
  | { type: PacketType.IMMUNE_UPDATE; senderId: number; indices: number[] }
  | { type: PacketType.READY_STATE; senderId: number; ready: boolean }
  | { type: PacketType.GAME_MOVES; senderId: number; moves: QueuedMove[] }
  | { type: PacketType.OPPONENT_DISCONNECTED; value: boolean }
  | { type: PacketType.GAME_UPDATE; update: GameUpdate }
  | {
      type: PacketType.LOBBY_CREATED
      code: string
      config: GameConfig
      isPrivate: boolean
    }
  | { type: PacketType.LOBBY_LIST; games: PublicGameSummary[] }
  | { type: PacketType.LOBBY_ERROR; reason: LobbyErrorReason }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function safeInteger(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`${field} must be a safe integer of at least ${minimum}.`)
  }
  return Number(value)
}

function nullableCommandId(value: unknown) {
  return value === null ? null : safeInteger(value, 'Command id')
}

function seat(value: unknown): Seat {
  if (value !== 0 && value !== 1) throw new Error('Seat must be 0 or 1.')
  return value
}

function matchId(value: unknown) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new Error('Match id must contain 1 through 128 characters.')
  }
  return value
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key))
}

function symbol(value: unknown): ClassicSymbol {
  if (value !== 'rock' && value !== 'paper' && value !== 'scissors') {
    throw new Error('Unsupported classic symbol.')
  }
  return value
}

function powerup(value: unknown): PowerupKey {
  if (value !== 'shield' && value !== 'reveal' && value !== 'extraTurn') {
    throw new Error('Unsupported power-up.')
  }
  return value
}

function decodeGameCommand(value: unknown): GameCommand {
  if (!isRecord(value)) throw new Error('Game command must be a keyed object.')
  switch (value.type) {
    case 'place':
      if (!hasOnlyKeys(value, ['type', 'locationId', 'symbol'])) {
        throw new Error('Place command contains unsupported fields.')
      }
      return {
        type: 'place',
        locationId: safeInteger(value.locationId, 'Location id'),
        symbol: symbol(value.symbol),
      }
    case 'activate-powerup':
      if (!hasOnlyKeys(value, ['type', 'powerup'])) {
        throw new Error('Power-up command contains unsupported fields.')
      }
      return { type: 'activate-powerup', powerup: powerup(value.powerup) }
    case 'select-shield-target':
      if (!hasOnlyKeys(value, ['type', 'locationId'])) {
        throw new Error('Shield command contains unsupported fields.')
      }
      return {
        type: 'select-shield-target',
        locationId: safeInteger(value.locationId, 'Location id'),
      }
    case 'timeout':
      if (!hasOnlyKeys(value, ['type'])) {
        throw new Error('Timeout command contains unsupported fields.')
      }
      return { type: 'timeout' }
    default:
      throw new Error('Unsupported game command.')
  }
}

function decodePlacement(value: unknown) {
  if (!isRecord(value) || !hasOnlyKeys(value, ['locationId', 'symbol'])) {
    throw new Error('Placement must be a keyed object.')
  }
  return {
    locationId: safeInteger(value.locationId, 'Location id'),
    symbol: symbol(value.symbol),
  }
}

function decodeScores(value: unknown): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('Scores must contain two values.')
  }
  return [
    safeInteger(value[0], 'First score'),
    safeInteger(value[1], 'Second score'),
  ]
}

function decodeDomainEvent(value: unknown): DomainEvent {
  if (!isRecord(value)) throw new Error('Domain event must be a keyed object.')
  switch (value.type) {
    case 'timeout':
    case 'turn-passed':
    case 'extra-turn-started':
      return { type: value.type, seat: seat(value.seat) }
    case 'cell-destroyed':
      return {
        type: value.type,
        seat: seat(value.seat),
        locationId: safeInteger(value.locationId, 'Location id'),
        symbol: symbol(value.symbol),
      }
    case 'shield-protected':
    case 'shield-selected':
      return {
        type: value.type,
        seat: seat(value.seat),
        locationId: safeInteger(value.locationId, 'Location id'),
      }
    case 'powerup-unlocked':
    case 'powerup-activated':
      return {
        type: value.type,
        seat: seat(value.seat),
        powerup: powerup(value.powerup),
      }
    case 'placements-committed':
      if (!Array.isArray(value.placements)) {
        throw new Error('Committed placements must be an array.')
      }
      return {
        type: value.type,
        seat: seat(value.seat),
        placements: value.placements.map(decodePlacement),
      }
    case 'game-finished': {
      const winner = value.winner === null ? null : seat(value.winner)
      return { type: value.type, scores: decodeScores(value.scores), winner }
    }
    default:
      throw new Error('Unsupported domain event.')
  }
}

// The server is expected to send an already-clamped config. This compares the
// clamped result against the RAW wire value, not against the decoded one:
// `decodeGameConfig` clamps internally, so comparing the two decoded objects
// would always match and validate nothing.
function matchesRawConfig(clamped: GameConfig, raw: Record<string, unknown>) {
  const scalars = [
    'boardSize',
    'streak',
    'rounds',
    'turnSeconds',
    'blindMode',
    'powerupsEnabled',
    'forbidImmediateRepeat',
  ] as const
  return scalars.every(
    (key) => !(key in raw) || raw[key] === clamped[key],
  )
}

function decodeStartDescriptor(value: unknown): GameStartDescriptor {
  if (!isRecord(value)) throw new Error('Game start descriptor is required.')
  if (
    !isRecord(value.engine) ||
    value.engine.id !== ENGINE_ID ||
    value.engine.revision !== ENGINE_REVISION
  ) {
    throw new Error('Unsupported engine revision.')
  }
  if (!isRecord(value.config)) throw new Error('Game start config is invalid.')
  const config = clampGameConfig(value.config)
  if (!matchesRawConfig(config, value.config)) {
    throw new Error('Game start config is outside supported limits.')
  }
  const revision = safeInteger(value.revision, 'Revision')
  if (revision !== 0) throw new Error('A game start must begin at revision 0.')
  const seed = safeInteger(value.seed, 'Seed')
  if (seed > 0xffff_ffff) throw new Error('Seed must be an unsigned 32-bit integer.')
  return {
    matchId: matchId(value.matchId),
    engine: { id: ENGINE_ID, revision: ENGINE_REVISION },
    config,
    seed,
    firstSeat: seat(value.firstSeat),
    revision: 0,
    turnTimeRemainingMs: safeInteger(
      value.turnTimeRemainingMs,
      'Turn time remaining',
    ),
  }
}

const REJECTION_REASONS = new Set<GameUpdateRejectionReason>([
  'invalid-command',
  'not-active-seat',
  'game-finished',
  'unknown-location',
  'location-occupied',
  'powerup-locked',
  'powerup-used',
  'shield-selection-pending',
  'shield-selection-not-pending',
  'invalid-shield-target',
  'no-active-match',
  'wrong-match',
  'stale-revision',
  'command-id-reused',
  'legacy-gameplay-disabled',
])

function decodeGameUpdate(value: unknown): GameUpdate {
  if (!isRecord(value)) throw new Error('Game update must be a keyed object.')
  if (value.status === 'accepted') {
    if (!Array.isArray(value.commands) || !Array.isArray(value.events)) {
      throw new Error('Accepted update commands and events must be arrays.')
    }
    const remaining = value.turnTimeRemainingMs
    if (remaining !== null && !Number.isSafeInteger(remaining)) {
      throw new Error('Turn time remaining must be an integer or null.')
    }
    if (typeof remaining === 'number' && remaining < 0) {
      throw new Error('Turn time remaining cannot be negative.')
    }
    return {
      status: 'accepted',
      matchId: matchId(value.matchId),
      commandId: nullableCommandId(value.commandId),
      fromRevision: safeInteger(value.fromRevision, 'From revision'),
      toRevision: safeInteger(value.toRevision, 'To revision'),
      actorSeat: seat(value.actorSeat),
      commands: value.commands.map(decodeGameCommand),
      events: value.events.map(decodeDomainEvent),
      turnTimeRemainingMs: remaining as number | null,
    }
  }
  if (value.status === 'rejected') {
    if (!REJECTION_REASONS.has(value.reason as GameUpdateRejectionReason)) {
      throw new Error('Unsupported game rejection reason.')
    }
    return {
      status: 'rejected',
      matchId: matchId(value.matchId),
      commandId: nullableCommandId(value.commandId),
      currentRevision: safeInteger(value.currentRevision, 'Current revision'),
      reason: value.reason as GameUpdateRejectionReason,
    }
  }
  throw new Error('Unsupported game update status.')
}

function toPacketArray(data: ArrayBuffer | Uint8Array) {
  const raw = decode(data instanceof Uint8Array ? data : new Uint8Array(data))
  if (!Array.isArray(raw)) {
    throw new Error('Expected a MessagePack array packet')
  }

  return raw as unknown[]
}

function normalizeUsers(value: unknown): UserEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (Array.isArray(entry) && entry.length >= 2) {
      return [{ userId: Number(entry[0]), userName: String(entry[1]) }]
    }

    if (
      entry &&
      typeof entry === 'object' &&
      'userId' in entry &&
      'userName' in entry
    ) {
      return [
        {
          userId: Number(entry.userId),
          userName: String(entry.userName),
        },
      ]
    }

    return []
  })
}

export function decodePacket(data: ArrayBuffer | Uint8Array): DecodedPacket {
  const decoded = toPacketArray(data)
  const packetType = Number(decoded[1]) as PacketType

  switch (packetType) {
    case PacketType.ID_ASSIGN:
      return {
        type: packetType,
        clientId: Number(decoded[2]),
      }
    case PacketType.SERVER_RESPONSE:
      return {
        type: packetType,
        success: Boolean(decoded[2]),
        originalPacketType:
          typeof decoded[3] === 'number' ? (decoded[3] as PacketType) : undefined,
      }
    case PacketType.USER_INFO:
      return {
        type: packetType,
        users: normalizeUsers(decoded[2]),
      }
    case PacketType.MATCH_FOUND:
      return {
        type: packetType,
        roomId: String(decoded[2]),
        config: clampGameConfig(decodeGameConfig(decoded[3]) ?? DEFAULT_GAME_CONFIG),
      }
    case PacketType.LOBBY_CREATED: {
      const payload = decoded[2]
      if (!isRecord(payload)) throw new Error('Lobby created payload is required.')
      return {
        type: packetType,
        code: String(payload.code),
        config: clampGameConfig(payload.config),
        isPrivate: payload.isPrivate === true,
      }
    }
    case PacketType.LOBBY_LIST: {
      const rows = Array.isArray(decoded[2]) ? decoded[2] : []
      return {
        type: packetType,
        games: rows.filter(isRecord).map((row) => ({
          code: String(row.code),
          hostName: String(row.hostName),
          config: clampGameConfig(row.config),
        })),
      }
    }
    case PacketType.LOBBY_ERROR: {
      const reason = decoded[2]
      if (!LOBBY_ERROR_REASONS.includes(reason as LobbyErrorReason)) {
        throw new Error('Unsupported lobby error reason.')
      }
      return { type: packetType, reason: reason as LobbyErrorReason }
    }
    case PacketType.GAME_START:
      return {
        type: packetType,
        firstPlayerId: safeInteger(decoded[2], 'First player id', 1),
        descriptor: decodeStartDescriptor(decoded[3]),
      }
    case PacketType.GAME_MOVE:
      return {
        type: packetType,
        senderId: Number(decoded[0]),
        index: Number(decoded[2]),
        symbol: decodeWireSymbol(decoded[3]),
      }
    case PacketType.IMMUNE_UPDATE:
      return {
        type: packetType,
        senderId: Number(decoded[0]),
        indices: Array.isArray(decoded[2]) ? decoded[2].map(Number) : [],
      }
    case PacketType.READY_STATE:
      return {
        type: packetType,
        senderId: Number(decoded[0]),
        ready: Boolean(decoded[2]),
      }
    case PacketType.GAME_MOVES:
      if (!Array.isArray(decoded[2]) || !Array.isArray(decoded[3])) {
        return {
          type: packetType,
          senderId: Number(decoded[0]),
          moves: [],
        }
      }

      {
        const indices = decoded[2] as unknown[]
        const colors = decoded[3] as unknown[]

        return {
          type: packetType,
          senderId: Number(decoded[0]),
          moves: indices.map((value, index) => ({
            index: Number(value),
            symbol: decodeWireSymbol(colors[index]),
          })),
        }
      }
    case PacketType.OPPONENT_DISCONNECTED:
      return {
        type: packetType,
        value: Boolean(decoded[2]),
      }
    case PacketType.GAME_UPDATE:
      return { type: packetType, update: decodeGameUpdate(decoded[2]) }
    default:
      throw new Error(`Unsupported packet type: ${packetType}`)
  }
}

export function encodeUserInfoPacket(senderId: number, userName: string) {
  return encode([senderId, PacketType.USER_INFO, userName])
}

export function encodeRoomJoinPacket(senderId: number, roomId: string) {
  return encode([senderId, PacketType.ROOM_JOIN, roomId])
}

export function encodeRoomLeavePacket(senderId: number, roomId: string) {
  return encode([senderId, PacketType.ROOM_LEAVE, roomId])
}

export function encodeMatchmakingPacket(
  senderId: number,
  isSearching: boolean,
  proposedConfig?: GameConfig,
) {
  return encode([
    senderId,
    PacketType.MATCHMAKING_REQUEST,
    isSearching,
    ...(proposedConfig ? [proposedConfig] : []),
  ])
}

export function encodeReadyPacket(senderId: number, isReady: boolean) {
  return encode([senderId, PacketType.READY_STATE, isReady])
}

export function encodeLobbyCreatePacket(
  senderId: number,
  config: GameConfig,
  isPrivate: boolean,
) {
  return encode([senderId, PacketType.LOBBY_CREATE, config, isPrivate])
}

export function encodeLobbyJoinPacket(senderId: number, code: string) {
  return encode([senderId, PacketType.LOBBY_JOIN, code.trim().toUpperCase()])
}

export function encodeLobbyCancelPacket(senderId: number) {
  return encode([senderId, PacketType.LOBBY_CANCEL])
}

export function encodeLobbySubscribePacket(
  senderId: number,
  subscribed: boolean,
) {
  return encode([senderId, PacketType.LOBBY_SUBSCRIBE, subscribed])
}

export function encodeGameCommandPacket(
  senderId: number,
  envelope: GameCommandEnvelope,
) {
  if ((envelope.command as GameCommand).type === 'timeout') {
    throw new Error('Clients cannot send timeout commands.')
  }
  return encode([senderId, PacketType.GAME_COMMAND, envelope])
}
