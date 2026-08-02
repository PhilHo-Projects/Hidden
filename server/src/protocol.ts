import { decode, encode } from '@msgpack/msgpack'
import type {
  DomainEvent,
  GameCommand,
  RejectionReason,
  Seat,
} from '@hidden/game-core'
import { decodeMatchRules, type MatchRules } from './matchRules'

export enum PacketType {
  ID_ASSIGN = 2,
  ROOM_JOIN = 5,
  ROOM_LEAVE = 6,
  SERVER_RESPONSE = 8,
  USER_INFO = 9,
  GAME_MOVE = 10,
  IMMUNE_UPDATE = 11,
  READY_STATE = 12,
  MATCHMAKING_REQUEST = 13,
  MATCH_FOUND = 14,
  GAME_START = 15,
  OPPONENT_DISCONNECTED = 17,
  GAME_MOVES = 18,
  GAME_COMMAND = 19,
  GAME_UPDATE = 20,
}

export type PaintColor = 'green' | 'blue' | 'red'

export type ClientGameCommand = Exclude<GameCommand, { type: 'timeout' }>

export interface GameCommandEnvelope {
  readonly matchId: string
  readonly commandId: number
  readonly expectedRevision: number
  readonly command: ClientGameCommand | null
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

export type ClientPacket =
  | { type: PacketType.USER_INFO; username: string }
  | { type: PacketType.ROOM_JOIN; roomId: 'lobby' }
  | { type: PacketType.ROOM_LEAVE; roomId: string }
  | {
      type: PacketType.MATCHMAKING_REQUEST
      searching: boolean
      proposedRules?: MatchRules
    }
  | { type: PacketType.READY_STATE; ready: boolean }
  | { type: PacketType.GAME_MOVE; index: number; color: PaintColor }
  | {
      type: PacketType.GAME_MOVES
      moves: Array<{ index: number; color: PaintColor }>
    }
  | { type: PacketType.IMMUNE_UPDATE; indices: number[] }
  | { type: PacketType.GAME_COMMAND; envelope: GameCommandEnvelope }

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolError'
  }
}

function assertPacketArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new ProtocolError('Expected a MessagePack packet array.')
  }
  return value
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ProtocolError(`${field} must be a boolean.`)
  }
  return value
}

function assertBoardIndex(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 8) {
    throw new ProtocolError('Board index must be an integer from 0 through 8.')
  }
  return Number(value)
}

function assertColor(value: unknown): PaintColor {
  if (value !== 'green' && value !== 'blue' && value !== 'red') {
    throw new ProtocolError('Color must be green, blue, or red.')
  }
  return value
}

function assertRoomId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) {
    throw new ProtocolError('Room id must contain 1 through 64 characters.')
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function assertNonNegativeSafeInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ProtocolError(`${field} must be a non-negative safe integer.`)
  }
  return Number(value)
}

function normalizeClientGameCommand(value: unknown): ClientGameCommand | null {
  if (!isRecord(value)) {
    return null
  }

  switch (value.type) {
    case 'place':
      if (
        !Number.isSafeInteger(value.locationId) ||
        Number(value.locationId) < 0 ||
        (value.symbol !== 'rock' &&
          value.symbol !== 'paper' &&
          value.symbol !== 'scissors')
      ) {
        return null
      }
      return {
        type: 'place',
        locationId: Number(value.locationId),
        symbol: value.symbol,
      }
    case 'activate-powerup':
      if (
        value.powerup !== 'shield' &&
        value.powerup !== 'reveal' &&
        value.powerup !== 'extraTurn'
      ) {
        return null
      }
      return { type: 'activate-powerup', powerup: value.powerup }
    case 'select-shield-target':
      if (
        !Number.isSafeInteger(value.locationId) ||
        Number(value.locationId) < 0
      ) {
        return null
      }
      return {
        type: 'select-shield-target',
        locationId: Number(value.locationId),
      }
    default:
      return null
  }
}

function decodeGameCommandEnvelope(value: unknown): GameCommandEnvelope {
  if (!isRecord(value)) {
    throw new ProtocolError('Game command envelope must be a keyed object.')
  }
  if (
    typeof value.matchId !== 'string' ||
    value.matchId.length < 1 ||
    value.matchId.length > 128
  ) {
    throw new ProtocolError('Match id must contain 1 through 128 characters.')
  }
  if (!Object.hasOwn(value, 'command')) {
    throw new ProtocolError('Game command envelope must contain a command.')
  }

  return {
    matchId: value.matchId,
    commandId: assertNonNegativeSafeInteger(value.commandId, 'Command id'),
    expectedRevision: assertNonNegativeSafeInteger(
      value.expectedRevision,
      'Expected revision',
    ),
    command: normalizeClientGameCommand(value.command),
  }
}

function decodeRaw(bytes: Uint8Array) {
  try {
    return assertPacketArray(decode(bytes))
  } catch (error) {
    if (error instanceof ProtocolError) {
      throw error
    }
    throw new ProtocolError('MessagePack payload could not be decoded.')
  }
}

export function decodeClientPacket(bytes: Uint8Array): ClientPacket {
  const packet = decodeRaw(bytes)
  const type = Number(packet[1]) as PacketType

  switch (type) {
    case PacketType.USER_INFO: {
      if (typeof packet[2] !== 'string') {
        throw new ProtocolError('Username must be a string.')
      }
      const username = packet[2].trim()
      if (username.length < 1 || username.length > 24) {
        throw new ProtocolError('Username must contain 1 through 24 characters.')
      }
      return { type, username }
    }
    case PacketType.ROOM_JOIN: {
      const roomId = assertRoomId(packet[2])
      if (roomId !== 'lobby') {
        throw new ProtocolError('Only the lobby room may be joined directly.')
      }
      return { type, roomId }
    }
    case PacketType.ROOM_LEAVE:
      return { type, roomId: assertRoomId(packet[2]) }
    case PacketType.MATCHMAKING_REQUEST: {
      const proposedRules = decodeMatchRules(packet[3])
      return {
        type,
        searching: assertBoolean(packet[2], 'Searching state'),
        ...(proposedRules ? { proposedRules } : {}),
      }
    }
    case PacketType.READY_STATE:
      return { type, ready: assertBoolean(packet[2], 'Ready state') }
    case PacketType.GAME_MOVE:
      return {
        type,
        index: assertBoardIndex(packet[2]),
        color: assertColor(packet[3]),
      }
    case PacketType.IMMUNE_UPDATE: {
      if (!Array.isArray(packet[2]) || packet[2].length !== 1) {
        throw new ProtocolError('Immune update must contain exactly one index.')
      }
      return { type, indices: packet[2].map(assertBoardIndex) }
    }
    case PacketType.GAME_MOVES: {
      const indices = packet[2]
      const colors = packet[3]
      if (
        !Array.isArray(indices) ||
        !Array.isArray(colors) ||
        indices.length < 1 ||
        indices.length > 2 ||
        indices.length !== colors.length
      ) {
        throw new ProtocolError('Game moves must contain one or two aligned moves.')
      }
      return {
        type,
        moves: indices.map((index, position) => ({
          index: assertBoardIndex(index),
          color: assertColor(colors[position]),
        })),
      }
    }
    case PacketType.GAME_COMMAND:
      return { type, envelope: decodeGameCommandEnvelope(packet[2]) }
    default:
      throw new ProtocolError(`Unsupported packet type: ${type}.`)
  }
}

export function encodePacket(packet: unknown[]): Uint8Array {
  return encode(packet)
}
