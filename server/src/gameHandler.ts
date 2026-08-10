import WebSocket from 'ws'
import type { AdminRuntimeStats } from './admin/repository'
import { type UserRole } from './auth/service'
import { type Logger } from './logger'
import {
  MatchCoordinator,
  type GameUpdateDelivery,
  type MatchRoom,
} from './matchCoordinator'
import { type GameConfig } from './matchRules'
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
  role: UserRole
  rateWindowStartedAt: number
}

export interface ClientIdentity {
  accountId: string
  role: UserRole
  username: string
}

export interface GameHandlerOptions {
  maxMessagesPerSecond: number
  logger: Logger
  matchCoordinator?: MatchCoordinator
}

export class GameHandler {
  private readonly sessionsById = new Map<number, ClientSession>()
  private readonly lobby = new Set<number>()
  private readonly lobbySubscribers = new Set<number>()
  private readonly matchCoordinator: MatchCoordinator
  private nextClientId = 1

  constructor(private readonly options: GameHandlerOptions) {
    this.matchCoordinator = options.matchCoordinator ?? new MatchCoordinator()
    this.matchCoordinator.subscribeDeliveries((deliveries) => {
      this.sendGameUpdates(deliveries)
    })
  }

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

  getRuntimeStats(): AdminRuntimeStats {
    const named = [...this.sessionsById.values()].filter(
      (session) => typeof session.username === 'string',
    )
    const authenticatedPlayers = named.filter(
      (session) => session.accountId !== undefined,
    ).length
    const coordinator = this.matchCoordinator.getRuntimeStats()
    return {
      connections: this.sessionsById.size,
      onlinePlayers: this.sessionsById.size,
      namedPlayers: named.length,
      authenticatedPlayers,
      guestPlayers: named.length - authenticatedPlayers,
      ...coordinator,
    }
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
          packet.proposedConfig,
        )
        break
      case PacketType.READY_STATE:
        this.updateReadyState(session, packet.ready)
        break
      case PacketType.GAME_COMMAND:
        this.sendGameUpdates(
          this.matchCoordinator.handleGameCommand(
            session.id,
            packet.envelope,
          ),
        )
        break
      case PacketType.GAME_MOVE:
        this.rejectLegacyGameplay(session)
        break
      case PacketType.GAME_MOVES:
        this.rejectLegacyGameplay(session)
        break
      case PacketType.IMMUNE_UPDATE:
        this.rejectLegacyGameplay(session)
        break
      case PacketType.LOBBY_CREATE:
        this.createPrivateGame(session, packet.config, packet.isPrivate)
        break
      case PacketType.LOBBY_JOIN:
        this.joinPrivateGame(session, packet.code)
        break
      case PacketType.LOBBY_CANCEL:
        if (this.matchCoordinator.cancelPendingGame(session.id)) {
          this.broadcastLobbyList()
        }
        break
      case PacketType.LOBBY_SUBSCRIBE:
        if (packet.subscribed) {
          this.lobbySubscribers.add(session.id)
          this.send(session, [
            0,
            PacketType.LOBBY_LIST,
            this.matchCoordinator.listPublicGames(),
          ])
        } else {
          this.lobbySubscribers.delete(session.id)
        }
        break
    }
  }

  private broadcastLobbyList() {
    const games = this.matchCoordinator.listPublicGames()
    for (const clientId of this.lobbySubscribers) {
      const subscriber = this.sessionsById.get(clientId)
      if (subscriber) {
        this.send(subscriber, [0, PacketType.LOBBY_LIST, games])
      }
    }
  }

  private createPrivateGame(
    session: ClientSession,
    config: GameConfig,
    isPrivate: boolean,
  ) {
    if (!session.username || session.roomId !== 'lobby') {
      throw new ProtocolError('Join the lobby before creating a game.')
    }

    // Unlike Quick Match, the config is accepted from any player, guests
    // included: a host sets the rules of their own game.
    const result = this.matchCoordinator.createPendingGame(
      {
        ...(session.accountId ? { accountId: session.accountId } : {}),
        connectionId: session.id,
        username: session.username,
      },
      config,
      isPrivate,
    )
    if ('error' in result) {
      this.send(session, [0, PacketType.LOBBY_ERROR, result.error])
      return
    }

    this.send(session, [
      0,
      PacketType.LOBBY_CREATED,
      { code: result.code, config: result.config, isPrivate: result.isPrivate },
    ])
    this.options.logger('info', 'lobby.game_created', {
      clientId: session.id,
      isPrivate,
    })
    this.broadcastLobbyList()
  }

  private joinPrivateGame(session: ClientSession, code: string) {
    if (!session.username || session.roomId !== 'lobby') {
      throw new ProtocolError('Join the lobby before joining a game.')
    }

    const result = this.matchCoordinator.joinPendingGame(code, {
      ...(session.accountId ? { accountId: session.accountId } : {}),
      connectionId: session.id,
      username: session.username,
    })
    if ('error' in result) {
      this.send(session, [0, PacketType.LOBBY_ERROR, result.error])
      return
    }

    this.announceMatch(result)
    this.broadcastLobbyList()
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
    proposedConfig?: GameConfig,
  ) {
    if (!searching) {
      this.matchCoordinator.cancelQuickMatch(session.id)
      return
    }

    let trustedConfig: GameConfig | undefined
    if (proposedConfig) {
      if (session.role === 'admin') {
        trustedConfig = proposedConfig
      } else {
        this.options.logger('debug', 'matchmaking.config_ignored', {
          clientId: session.id,
        })
      }
    }

    if (!session.username || session.roomId !== 'lobby') {
      return
    }

    const room = this.matchCoordinator.enqueueQuickMatch(
      {
        ...(session.accountId ? { accountId: session.accountId } : {}),
        connectionId: session.id,
        username: session.username,
      },
      trustedConfig,
    )
    if (!room) {
      return
    }

    this.announceMatch(room)
  }

  // Shared by Quick Match and the private lobby so both produce an identical
  // MATCH_FOUND and reuse the existing ready/start flow unchanged.
  private announceMatch(room: MatchRoom) {
    const playerIds = room.participants.map(
      (participant) => participant.connectionId,
    )
    for (const playerId of playerIds) {
      const player = this.sessionsById.get(playerId)
      if (!player) {
        continue
      }
      this.lobby.delete(playerId)
      this.lobbySubscribers.delete(playerId)
      player.roomId = room.id
      this.send(player, [0, PacketType.MATCH_FOUND, room.id, room.config])
    }
    this.options.logger('info', 'match.created', {
      roomId: room.id,
      playerIds,
      config: room.config,
    })
  }

  private updateReadyState(session: ClientSession, ready: boolean) {
    const room = this.matchCoordinator.getRoomForConnection(session.id)
    if (!room || session.roomId !== room.id) {
      throw new ProtocolError('Client is not a member of an active match.')
    }

    const transition = this.matchCoordinator.setReady(session.id, ready)
    for (const opponentId of transition.opponentConnectionIds) {
      const opponent = this.sessionsById.get(opponentId)
      if (opponent) {
        this.send(opponent, [session.id, PacketType.READY_STATE, ready])
      }
    }

    if (transition.start) {
      const { descriptor, firstConnectionId } = transition.start
      for (const participant of room.participants) {
        const playerId = participant.connectionId
        const player = this.sessionsById.get(playerId)
        if (player) {
          this.send(player, [
            0,
            PacketType.GAME_START,
            firstConnectionId,
            descriptor,
          ])
        }
      }
      this.options.logger('info', 'match.started', {
        roomId: room.id,
        matchId: descriptor.matchId,
        firstPlayerId: firstConnectionId,
      })
    }
  }

  private rejectLegacyGameplay(session: ClientSession) {
    this.sendGameUpdates(
      this.matchCoordinator.rejectLegacyGameplay(session.id),
    )
  }

  private sendGameUpdates(deliveries: readonly GameUpdateDelivery[]) {
    for (const delivery of deliveries) {
      const recipient = this.sessionsById.get(delivery.connectionId)
      if (recipient) {
        this.send(recipient, [0, PacketType.GAME_UPDATE, delivery.update])
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
    this.matchCoordinator.cancelQuickMatch(session.id)
    this.lobby.delete(session.id)
    this.lobbySubscribers.delete(session.id)
    // A dropped host must not leave an unjoinable game in everyone's list.
    if (this.matchCoordinator.cancelPendingGame(session.id)) {
      this.broadcastLobbyList()
    }

    const roomId = session.roomId
    session.roomId = undefined
    if (!roomId || roomId === 'lobby') {
      return
    }

    const abandoned = this.matchCoordinator.abandon(session.id)
    if (!abandoned) {
      return
    }

    for (const playerId of abandoned.remainingConnectionIds) {
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
      roomId: abandoned.roomId,
      disconnectedClientId: session.id,
    })
  }
}
