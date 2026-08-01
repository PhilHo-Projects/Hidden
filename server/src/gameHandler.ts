import WebSocket from 'ws'
import { type UserRole } from './auth/service'
import { type Logger } from './logger'
import {
  clampMatchRules,
  DEFAULT_MATCH_RULES,
  type MatchRules,
} from './matchRules'
import {
  decodeClientPacket,
  encodePacket,
  PacketType,
  ProtocolError,
  type ClientPacket,
} from './protocol'

interface ClientSession {
  accountId: string | undefined
  id: number
  socket: WebSocket
  username: string | undefined
  roomId: string | undefined
  alive: boolean
  messageCount: number
  proposedRules?: MatchRules
  role: UserRole
  rateWindowStartedAt: number
}

interface Match {
  players: [number, number]
  ready: Set<number>
  rules: MatchRules
}

export interface ClientIdentity {
  accountId: string
  role: UserRole
  username: string
}

export interface GameHandlerOptions {
  maxMessagesPerSecond: number
  logger: Logger
}

export class GameHandler {
  private readonly sessionsById = new Map<number, ClientSession>()
  private readonly lobby = new Set<number>()
  private readonly matchmakingQueue = new Set<number>()
  private readonly matches = new Map<string, Match>()
  private nextClientId = 1

  constructor(private readonly options: GameHandlerOptions) {}

  add(socket: WebSocket, identity?: ClientIdentity) {
    const id = this.nextClientId++
    const session: ClientSession = {
      id,
      accountId: identity?.accountId,
      socket,
      username: identity?.username,
      roomId: undefined,
      alive: true,
      messageCount: 0,
      role: identity?.role ?? 'player',
      rateWindowStartedAt: Date.now(),
    }

    this.sessionsById.set(id, session)
    socket.send(encodePacket([0, PacketType.ID_ASSIGN, id]))
    this.options.logger('info', 'client.connected', {
      clientId: id,
      connectionCount: this.sessionsById.size,
    })

    socket.on('pong', () => {
      session.alive = true
    })
    socket.on('message', (data, isBinary) => {
      this.handleMessage(session, data, isBinary)
    })
    socket.on('close', (code) => {
      this.remove(session, code)
    })
    socket.on('error', (error) => {
      this.options.logger('warn', 'client.socket_error', {
        clientId: id,
        error: error.message,
      })
    })
  }

  get connectionCount() {
    return this.sessionsById.size
  }

  heartbeat() {
    for (const session of this.sessionsById.values()) {
      if (!session.alive) {
        this.options.logger('info', 'client.stale', { clientId: session.id })
        session.socket.terminate()
        continue
      }

      session.alive = false
      session.socket.ping()
    }
  }

  closeAll() {
    for (const session of this.sessionsById.values()) {
      session.socket.close(1012, 'Server restarting')
    }
  }

  terminateAll() {
    for (const session of this.sessionsById.values()) {
      session.socket.terminate()
    }
  }

  private handleMessage(
    session: ClientSession,
    data: WebSocket.RawData,
    isBinary: boolean,
  ) {
    if (!isBinary || !this.withinRateLimit(session)) {
      session.socket.close(1008, 'Policy violation')
      return
    }

    try {
      const bytes = this.toUint8Array(data)
      const packet = decodeClientPacket(bytes)
      this.options.logger('debug', 'packet.received', {
        clientId: session.id,
        packetType: packet.type,
        payloadBytes: bytes.byteLength,
      })
      this.route(session, packet)
    } catch (error) {
      const message =
        error instanceof ProtocolError ? error.message : 'Unexpected packet error.'
      this.options.logger('warn', 'packet.rejected', {
        clientId: session.id,
        error: message,
      })
      session.socket.close(1008, 'Invalid packet')
    }
  }

  private withinRateLimit(session: ClientSession) {
    const now = Date.now()
    if (now - session.rateWindowStartedAt >= 1000) {
      session.rateWindowStartedAt = now
      session.messageCount = 0
    }

    session.messageCount += 1
    return session.messageCount <= this.options.maxMessagesPerSecond
  }

  private toUint8Array(data: WebSocket.RawData): Uint8Array {
    if (Buffer.isBuffer(data)) {
      return data
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data)
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data)
    }
    throw new ProtocolError('Unsupported binary payload.')
  }

  private route(session: ClientSession, packet: ClientPacket) {
    switch (packet.type) {
      case PacketType.USER_INFO:
        if (!session.accountId) {
          if (!/^Guest#\d{4}$/.test(packet.username)) {
            throw new ProtocolError(
              'Guest username must use the Guest#NNNN format.',
            )
          }
          session.username = packet.username
        }
        this.broadcastUsers()
        this.respond(session, true, packet.type)
        break
      case PacketType.ROOM_JOIN:
        this.joinLobby(session, packet.type)
        break
      case PacketType.ROOM_LEAVE:
        this.leaveRoom(session, packet.roomId, packet.type)
        break
      case PacketType.MATCHMAKING_REQUEST:
        this.updateMatchmaking(
          session,
          packet.searching,
          packet.proposedRules,
        )
        break
      case PacketType.READY_STATE:
        this.updateReadyState(session, packet.ready)
        break
      case PacketType.GAME_MOVE:
        this.relayToOpponent(session, [
          session.id,
          packet.type,
          packet.index,
          packet.color,
        ])
        break
      case PacketType.GAME_MOVES:
        this.relayToOpponent(session, [
          session.id,
          packet.type,
          packet.moves.map(({ index }) => index),
          packet.moves.map(({ color }) => color),
        ])
        break
      case PacketType.IMMUNE_UPDATE:
        this.relayToOpponent(session, [
          session.id,
          packet.type,
          packet.indices,
        ])
        break
    }
  }

  private joinLobby(session: ClientSession, responseType: PacketType) {
    if (!session.username || session.roomId) {
      this.respond(session, false, responseType)
      return
    }

    session.roomId = 'lobby'
    this.lobby.add(session.id)
    this.respond(session, true, responseType)
    this.options.logger('info', 'lobby.joined', { clientId: session.id })
  }

  private leaveRoom(
    session: ClientSession,
    requestedRoomId: string,
    responseType: PacketType,
  ) {
    if (session.roomId !== requestedRoomId) {
      this.respond(session, false, responseType)
      return
    }

    this.detachFromRoom(session, true)
    this.respond(session, true, responseType)
  }

  private updateMatchmaking(
    session: ClientSession,
    searching: boolean,
    proposedRules?: MatchRules,
  ) {
    delete session.proposedRules

    if (!searching) {
      this.matchmakingQueue.delete(session.id)
      return
    }

    if (proposedRules) {
      if (session.role === 'admin') {
        session.proposedRules = proposedRules
      } else {
        this.options.logger('debug', 'matchmaking.rules_ignored', {
          clientId: session.id,
        })
      }
    }

    if (!session.username || session.roomId !== 'lobby') {
      return
    }

    this.matchmakingQueue.add(session.id)
    this.tryCreateMatch()
  }

  private tryCreateMatch() {
    const eligible = [...this.matchmakingQueue].filter((id) => {
      const session = this.sessionsById.get(id)
      return Boolean(session?.username && session.roomId === 'lobby')
    })
    if (eligible.length < 2) {
      return
    }

    const firstId = eligible[0]!
    const secondId = eligible[1]!
    const first = this.sessionsById.get(firstId)!
    const second = this.sessionsById.get(secondId)!
    const roomId = `match_${Date.now()}_${firstId}_${secondId}`
    const rules = clampMatchRules(
      first.proposedRules ?? second.proposedRules ?? DEFAULT_MATCH_RULES,
    )

    this.matchmakingQueue.delete(firstId)
    this.matchmakingQueue.delete(secondId)
    delete first.proposedRules
    delete second.proposedRules
    this.lobby.delete(firstId)
    this.lobby.delete(secondId)
    first.roomId = roomId
    second.roomId = roomId
    this.matches.set(roomId, {
      players: [firstId, secondId],
      ready: new Set(),
      rules,
    })

    this.send(first, [0, PacketType.MATCH_FOUND, roomId, rules])
    this.send(second, [0, PacketType.MATCH_FOUND, roomId, rules])
    this.options.logger('info', 'match.created', {
      roomId,
      playerIds: [firstId, secondId],
      rules,
    })
  }

  private updateReadyState(session: ClientSession, ready: boolean) {
    const match = session.roomId ? this.matches.get(session.roomId) : undefined
    if (!match || !match.players.includes(session.id)) {
      throw new ProtocolError('Client is not a member of an active match.')
    }

    if (ready) {
      match.ready.add(session.id)
    } else {
      match.ready.delete(session.id)
    }

    this.relayToOpponent(session, [session.id, PacketType.READY_STATE, ready])

    if (match.ready.size === match.players.length) {
      const firstPlayerId =
        match.players[Math.floor(Math.random() * match.players.length)]!
      for (const playerId of match.players) {
        const player = this.sessionsById.get(playerId)
        if (player) {
          this.send(player, [0, PacketType.GAME_START, firstPlayerId])
        }
      }
      match.ready.clear()
      this.options.logger('info', 'match.started', {
        roomId: session.roomId,
        firstPlayerId,
      })
    }
  }

  private relayToOpponent(session: ClientSession, packet: unknown[]) {
    const match = session.roomId ? this.matches.get(session.roomId) : undefined
    if (!match || !match.players.includes(session.id)) {
      throw new ProtocolError('Client is not a member of an active match.')
    }

    for (const playerId of match.players) {
      if (playerId === session.id) {
        continue
      }
      const recipient = this.sessionsById.get(playerId)
      if (recipient) {
        this.send(recipient, packet)
      }
    }
  }

  private respond(session: ClientSession, success: boolean, type: PacketType) {
    this.send(session, [0, PacketType.SERVER_RESPONSE, success, type])
  }

  private broadcastUsers() {
    const users = [...this.sessionsById.values()]
      .filter(
        (session): session is ClientSession & { username: string } =>
          typeof session.username === 'string',
      )
      .map((session) => [session.id, session.username])
    const packet = encodePacket([0, PacketType.USER_INFO, users])

    for (const session of this.sessionsById.values()) {
      if (session.socket.readyState === WebSocket.OPEN) {
        session.socket.send(packet)
      }
    }
  }

  private send(session: ClientSession, packet: unknown[]) {
    if (session.socket.readyState === WebSocket.OPEN) {
      session.socket.send(encodePacket(packet))
    }
  }

  private remove(session: ClientSession, code: number) {
    if (!this.sessionsById.delete(session.id)) {
      return
    }

    this.detachFromRoom(session, true)
    this.broadcastUsers()
    this.options.logger('info', 'client.disconnected', {
      clientId: session.id,
      code,
      connectionCount: this.sessionsById.size,
    })
  }

  private detachFromRoom(session: ClientSession, notifyOpponent: boolean) {
    this.matchmakingQueue.delete(session.id)
    delete session.proposedRules
    this.lobby.delete(session.id)

    const roomId = session.roomId
    session.roomId = undefined
    if (!roomId || roomId === 'lobby') {
      return
    }

    const match = this.matches.get(roomId)
    if (!match) {
      return
    }

    this.matches.delete(roomId)
    for (const playerId of match.players) {
      if (playerId === session.id) {
        continue
      }
      const opponent = this.sessionsById.get(playerId)
      if (opponent) {
        opponent.roomId = undefined
        if (notifyOpponent) {
          this.send(opponent, [
            0,
            PacketType.OPPONENT_DISCONNECTED,
            true,
          ])
        }
      }
    }
    this.options.logger('info', 'match.ended', {
      roomId,
      disconnectedClientId: session.id,
    })
  }
}
