import { decode, encode } from '@msgpack/msgpack'
import { COLOR_BLUE, COLOR_GREEN, COLOR_RED } from './constants'
import {
  clampMatchRules,
  decodeMatchRules,
  DEFAULT_MATCH_RULES,
  type MatchRules,
} from './matchRules'
import type { PaintColor, QueuedMove } from './types'

export const LOBBY_ROOM_ID = 'lobby'
type WireColor = 'green' | 'blue' | 'red'

const colorToWire: Record<PaintColor, WireColor> = {
  [COLOR_GREEN]: 'green',
  [COLOR_BLUE]: 'blue',
  [COLOR_RED]: 'red',
}

function decodeWireColor(value: unknown): PaintColor {
  switch (value) {
    case 'green':
      return COLOR_GREEN
    case 'blue':
      return COLOR_BLUE
    case 'red':
      return COLOR_RED
    default:
      throw new Error(`Unsupported wire color: ${String(value)}`)
  }
}

export enum PacketType {
  CHAT = 0,
  POSITION = 1,
  ID_ASSIGN = 2,
  TIME_SYNC = 3,
  ROOM_CREATE = 4,
  ROOM_JOIN = 5,
  ROOM_LEAVE = 6,
  ROOM_DESTROY = 7,
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
}

export interface UserEntry {
  userId: number
  userName: string
}

export type DecodedPacket =
  | { type: PacketType.ID_ASSIGN; clientId: number }
  | { type: PacketType.TIME_SYNC; sequence: number; serverTime: number }
  | { type: PacketType.SERVER_RESPONSE; success: boolean; originalPacketType?: PacketType }
  | { type: PacketType.USER_INFO; users: UserEntry[] }
  | { type: PacketType.MATCH_FOUND; roomId: string; rules: MatchRules }
  | { type: PacketType.GAME_START; firstPlayerId: number }
  | { type: PacketType.GAME_MOVE; senderId: number; index: number; color: PaintColor }
  | { type: PacketType.IMMUNE_UPDATE; senderId: number; indices: number[] }
  | { type: PacketType.READY_STATE; senderId: number; ready: boolean }
  | { type: PacketType.GAME_MOVES; senderId: number; moves: QueuedMove[] }
  | { type: PacketType.OPPONENT_DISCONNECTED; value: boolean }

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
    case PacketType.TIME_SYNC:
      return {
        type: packetType,
        sequence: Number(decoded[2]),
        serverTime: Number(decoded[3]),
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
        rules: clampMatchRules(
          decodeMatchRules(decoded[3]) ?? DEFAULT_MATCH_RULES,
        ),
      }
    case PacketType.GAME_START:
      return {
        type: packetType,
        firstPlayerId: Number(decoded[2]),
      }
    case PacketType.GAME_MOVE:
      return {
        type: packetType,
        senderId: Number(decoded[0]),
        index: Number(decoded[2]),
        color: decodeWireColor(decoded[3]),
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
            color: decodeWireColor(colors[index]),
          })),
        }
      }
    case PacketType.OPPONENT_DISCONNECTED:
      return {
        type: packetType,
        value: Boolean(decoded[2]),
      }
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
  proposedRules?: MatchRules,
) {
  return encode([
    senderId,
    PacketType.MATCHMAKING_REQUEST,
    isSearching,
    ...(proposedRules ? [proposedRules] : []),
  ])
}

export function encodeReadyPacket(senderId: number, isReady: boolean) {
  return encode([senderId, PacketType.READY_STATE, isReady])
}

export function encodeGameMovePacket(senderId: number, index: number, color: PaintColor) {
  return encode([senderId, PacketType.GAME_MOVE, index, colorToWire[color]])
}

export function encodeGameMovesPacket(senderId: number, moves: QueuedMove[]) {
  return encode([
    senderId,
    PacketType.GAME_MOVES,
    moves.map((move) => move.index),
    moves.map((move) => colorToWire[move.color]),
  ])
}

export function encodeImmunePacket(senderId: number, indices: number[]) {
  return encode([senderId, PacketType.IMMUNE_UPDATE, indices])
}
