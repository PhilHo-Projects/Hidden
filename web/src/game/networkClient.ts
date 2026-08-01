import {
  decodePacket,
  encodeGameMovePacket,
  encodeGameMovesPacket,
  encodeImmunePacket,
  encodeMatchmakingPacket,
  encodeReadyPacket,
  encodeRoomJoinPacket,
  encodeRoomLeavePacket,
  encodeUserInfoPacket,
  PacketType,
  type DecodedPacket,
  type UserEntry,
} from './protocol'
import type { PaintColor, QueuedMove } from './types'
import type { MatchRules } from './matchRules'

export type ClientEvent =
  | { type: 'open' }
  | { type: 'close'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'assigned-id'; clientId: number }
  | { type: 'users'; users: UserEntry[] }
  | { type: 'match-found'; roomId: string; rules: MatchRules }
  | { type: 'game-start'; firstPlayerId: number; isMyTurn: boolean }
  | { type: 'hidden-move'; senderId: number; index: number; color: PaintColor }
  | { type: 'hidden-moves'; senderId: number; moves: QueuedMove[] }
  | { type: 'immune'; senderId: number; indices: number[] }
  | { type: 'opponent-disconnected' }

type EventListener = (event: ClientEvent) => void

interface NetworkClientOptions {
  responseTimeoutMs?: number
}

interface PendingResponse {
  resolve: (success: boolean) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface WebSocketLocation {
  override?: string
  protocol: string
  host: string
}

export function resolveWebSocketUrl({ override, protocol, host }: WebSocketLocation) {
  if (override) {
    return override
  }

  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws`
}

export class NetworkClient {
  private ws: WebSocket | null = null
  private listeners = new Set<EventListener>()
  private pendingResponses = new Map<PacketType, PendingResponse>()
  private closeReason = ''
  private readonly responseTimeoutMs: number
  clientId: number | null = null

  constructor(options: NetworkClientOptions = {}) {
    this.responseTimeoutMs = options.responseTimeoutMs ?? 5000
  }

  subscribe(listener: EventListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: ClientEvent) {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  async connect(url: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return
    }

    this.closeReason = ''

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url)
      ws.binaryType = 'arraybuffer'
      this.ws = ws

      ws.onopen = () => {
        this.emit({ type: 'open' })
        resolve()
      }

      ws.onerror = () => {
        const message = 'Unable to reach the Hidden server.'
        this.emit({ type: 'error', message })
        reject(new Error(message))
      }

      ws.onclose = (event) => {
        this.rejectPendingResponses(new Error('Connection closed before the server responded.'))
        this.emit({
          type: 'close',
          reason: this.closeReason || event.reason || 'Connection closed',
        })
        this.ws = null
      }

      ws.onmessage = (messageEvent) => {
        this.handleMessage(messageEvent.data)
      }
    })
  }

  close(reason = 'Connection closed by user') {
    this.closeReason = reason
    this.rejectPendingResponses(new Error(reason))
    this.ws?.close()
  }

  private ensureOpen() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected')
    }
  }

  private send(bytes: Uint8Array) {
    this.ensureOpen()
    this.ws!.send(bytes)
  }

  private sendWithResponse(packetType: PacketType, bytes: Uint8Array) {
    return new Promise<boolean>((resolve, reject) => {
      const previous = this.pendingResponses.get(packetType)
      if (previous) {
        clearTimeout(previous.timeout)
        previous.reject(new Error('A newer request replaced the pending request.'))
      }

      const timeout = setTimeout(() => {
        this.pendingResponses.delete(packetType)
        reject(new Error('Server response timed out.'))
      }, this.responseTimeoutMs)

      this.pendingResponses.set(packetType, { resolve, reject, timeout })
      this.send(bytes)
    })
  }

  private rejectPendingResponses(error: Error) {
    for (const pending of this.pendingResponses.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pendingResponses.clear()
  }

  async sendUserName(userName: string) {
    return this.sendWithResponse(
      PacketType.USER_INFO,
      encodeUserInfoPacket(this.clientId ?? 0, userName),
    )
  }

  async joinRoom(roomId: string) {
    return this.sendWithResponse(
      PacketType.ROOM_JOIN,
      encodeRoomJoinPacket(this.clientId ?? 0, roomId),
    )
  }

  async leaveRoom(roomId: string) {
    return this.sendWithResponse(
      PacketType.ROOM_LEAVE,
      encodeRoomLeavePacket(this.clientId ?? 0, roomId),
    )
  }

  startMatchmaking(proposedRules?: MatchRules) {
    this.send(
      encodeMatchmakingPacket(
        this.clientId ?? 0,
        true,
        proposedRules,
      ),
    )
  }

  cancelMatchmaking() {
    this.send(encodeMatchmakingPacket(this.clientId ?? 0, false))
  }

  sendReady(isReady: boolean) {
    this.send(encodeReadyPacket(this.clientId ?? 0, isReady))
  }

  sendMove(index: number, color: PaintColor) {
    this.send(encodeGameMovePacket(this.clientId ?? 0, index, color))
  }

  sendMoves(moves: QueuedMove[]) {
    this.send(encodeGameMovesPacket(this.clientId ?? 0, moves))
  }

  sendImmune(indices: number[]) {
    this.send(encodeImmunePacket(this.clientId ?? 0, indices))
  }

  private handleServerResponse(packet: Extract<DecodedPacket, { type: PacketType.SERVER_RESPONSE }>) {
    if (packet.originalPacketType === PacketType.OPPONENT_DISCONNECTED) {
      this.emit({ type: 'opponent-disconnected' })
      return
    }

    if (packet.originalPacketType === undefined) {
      return
    }

    const pending = this.pendingResponses.get(packet.originalPacketType)
    if (pending) {
      clearTimeout(pending.timeout)
      pending.resolve(packet.success)
      this.pendingResponses.delete(packet.originalPacketType)
    }
  }

  private handleDecoded(packet: DecodedPacket) {
    switch (packet.type) {
      case PacketType.ID_ASSIGN:
        this.clientId = packet.clientId
        this.emit({ type: 'assigned-id', clientId: packet.clientId })
        break
      case PacketType.SERVER_RESPONSE:
        this.handleServerResponse(packet)
        break
      case PacketType.USER_INFO:
        this.emit({ type: 'users', users: packet.users })
        break
      case PacketType.MATCH_FOUND:
        this.emit({
          type: 'match-found',
          roomId: packet.roomId,
          rules: packet.rules,
        })
        break
      case PacketType.GAME_START:
        this.emit({
          type: 'game-start',
          firstPlayerId: packet.firstPlayerId,
          isMyTurn: packet.firstPlayerId === this.clientId,
        })
        break
      case PacketType.GAME_MOVE:
        this.emit({
          type: 'hidden-move',
          senderId: packet.senderId,
          index: packet.index,
          color: packet.color,
        })
        break
      case PacketType.GAME_MOVES:
        this.emit({
          type: 'hidden-moves',
          senderId: packet.senderId,
          moves: packet.moves,
        })
        break
      case PacketType.IMMUNE_UPDATE:
        this.emit({
          type: 'immune',
          senderId: packet.senderId,
          indices: packet.indices,
        })
        break
      case PacketType.READY_STATE:
        break
      case PacketType.OPPONENT_DISCONNECTED:
        this.emit({ type: 'opponent-disconnected' })
        break
      case PacketType.TIME_SYNC:
        break
    }
  }

  private handleMessage(data: Blob | ArrayBuffer) {
    if (data instanceof Blob) {
      void data.arrayBuffer().then((buffer) => {
        this.handleDecoded(decodePacket(buffer))
      })
      return
    }

    this.handleDecoded(decodePacket(data))
  }
}
