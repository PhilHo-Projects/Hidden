import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import {
  type ClassicSymbol,
  type GameConfig,
} from '@hidden/game-core'
import type { UiStatus } from '../components/PregameUi'
import {
  applyOnlinePresentation,
  applyOfflineLocalMove,
  applyOfflinePowerup,
  applyOfflineRevealEnd,
  applyOfflineShieldSelection,
  createOfflineState,
  createOnlinePresentedState,
  forceOfflineTimeout,
  playOfflineBotTurn,
  selectSymbol,
  startOfflineMatch,
} from '../game/coreAdapter'
import {
  NetworkClient,
  resolveWebSocketUrl,
  type ClientEvent,
} from '../game/networkClient'
import {
  applyOnlineUpdate,
  createOnlineAuthority,
  getDisplayedTurnTimeMs,
  queueOnlineCommand,
  type OnlineAuthorityState,
} from '../game/onlineAuthority'
import {
  createOnlineMatchConfig,
  isOnlineTerminalScreen,
  MATCH_COUNTDOWN_STEPS,
  restartMatch,
  shouldResolveTimeoutLocally,
  tryMarkOnlineTerminalScreen,
} from '../game/onlineMatch'
import {
  LOBBY_ROOM_ID,
  type ClientGameCommand,
  type GameCommandEnvelope,
  type UserEntry,
} from '../game/protocol'
import type {
  EngineResult,
  GameState,
  MatchConfig,
  PowerupKey,
} from '../game/types'
import type { Screen } from '../game/viewModel'

const sleep = (ms: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, ms)
})

const wsUrl = () => resolveWebSocketUrl({
  override: import.meta.env.VITE_WS_URL,
  protocol: window.location.protocol,
  host: window.location.host,
})

const createNetworkClient = () => new NetworkClient()

function makeConfig(config: GameConfig, isOnline: boolean, hasAI: boolean): MatchConfig {
  return { ...config, isOnline, hasAI }
}

export interface MatchNetworkClient {
  clientId: number | null
  subscribe: (listener: (event: ClientEvent) => void) => () => void
  connect: (url: string) => Promise<void>
  close: (reason?: string) => void
  sendUserName: (userName: string) => Promise<boolean>
  joinRoom: (roomId: string) => Promise<boolean>
  startMatchmaking: (proposedConfig?: GameConfig) => void
  cancelMatchmaking: () => void
  sendReady: (isReady: boolean) => void
  sendGameCommand: (envelope: GameCommandEnvelope) => void
  createLobbyGame: (config: GameConfig, isPrivate: boolean) => void
  joinLobbyGame: (code: string) => void
  cancelLobbyGame: () => void
  subscribeLobby: (subscribed: boolean) => void
}

interface LobbyController {
  clearLobbyError: () => void
  beginHosting: () => void
  beginBrowsing: () => void
  clearForMatchFound: () => void
  leaveLobby: () => void
  handleClientEvent: (event: ClientEvent) => boolean
}

interface UseMatchSessionOptions {
  screen: Screen
  screenRef: RefObject<Screen>
  setScreen: (screen: Screen) => void
  setStatus: (status: UiStatus) => void
  lobby: LobbyController
  clearDestructionEffects: () => void
  queueDestructionEffect: (index: number) => void
  createClient?: () => MatchNetworkClient
}

export interface MatchSession {
  onlineRules: GameConfig | null
  match: GameState | null
  announcement: string
  users: UserEntry[]
  readyLocked: boolean
  countdown: string
  searchSeconds: number
  turnTimeLeft: number
  clientId: number | null
  onlineInputPending: boolean
  clearAnnouncement: () => void
  resetForAccountChange: (clearAnnouncement?: boolean) => void
  resetForHome: () => void
  resetForNavigation: (current: Screen, isOnlineMatch: boolean) => void
  startOffline: (config: GameConfig) => Promise<void>
  hostGame: (username: string, config: GameConfig, isPrivate: boolean) => Promise<void>
  findGames: (username: string) => Promise<void>
  leaveLobbyScreen: () => void
  startOnline: (username: string, proposedConfig?: GameConfig) => Promise<void>
  joinLobbyGame: (code: string) => void
  ready: () => void
  playAgain: () => void
  selectSymbol: (symbol: ClassicSymbol) => void
  selectCell: (index: number) => void
  activatePowerup: (powerup: PowerupKey) => void
  endReveal: () => void
}

export function useMatchSession({
  screen,
  screenRef,
  setScreen,
  setStatus,
  lobby,
  clearDestructionEffects,
  queueDestructionEffect,
  createClient = createNetworkClient,
}: UseMatchSessionOptions): MatchSession {
  const {
    clearLobbyError,
    beginHosting,
    beginBrowsing,
    clearForMatchFound,
    leaveLobby,
    handleClientEvent: handleLobbyClientEvent,
  } = lobby
  const [onlineRules, setOnlineRules] = useState<GameConfig | null>(null)
  const [match, setMatch] = useState<GameState | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [users, setUsers] = useState<UserEntry[]>([])
  const [readyLocked, setReadyLocked] = useState(false)
  const [countdown, setCountdown] = useState('3')
  const [searchSeconds, setSearchSeconds] = useState(0)
  const [turnTimeLeft, setTurnTimeLeft] = useState(0)
  const [clientId, setClientId] = useState<number | null>(null)
  const [onlineInputPending, setOnlineInputPending] = useState(false)

  const clientRef = useRef<MatchNetworkClient | null>(null)
  const matchRef = useRef<GameState | null>(null)
  const manualCloseRef = useRef(false)
  const onlineAuthorityRef = useRef<OnlineAuthorityState | null>(null)
  const countdownRunRef = useRef(0)

  useEffect(() => {
    matchRef.current = match
  }, [match])

  useEffect(() => {
    if (!announcement) return
    const id = window.setTimeout(() => setAnnouncement(''), 2400)
    return () => window.clearTimeout(id)
  }, [announcement])

  useEffect(() => {
    if (screen !== 'matchmaking') return
    const id = window.setInterval(() => setSearchSeconds((value) => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [screen])

  const applyEngineResult = useCallback((result: EngineResult) => {
    matchRef.current = result.state
    setMatch(result.state)
    const messages = result.events
      .filter((event) => event.type === 'announcement')
      .map((event) => event.message)
    if (messages.length > 0) setAnnouncement(messages.join(' / '))

    for (const event of result.events) {
      if (event.type === 'cell-destroyed' && event.board === 'player') {
        queueDestructionEffect(event.index)
      }
      if (event.type === 'game-over') {
        countdownRunRef.current += 1
        setScreen('results')
      }
    }
  }, [queueDestructionEffect, setScreen])

  const beginCountdown = useCallback(async (
    config: MatchConfig,
    isMyTurn: boolean,
    preparedOnlineState?: GameState,
  ) => {
    const runId = ++countdownRunRef.current
    const base = preparedOnlineState ?? createOfflineState(
      config,
      isMyTurn,
      crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
    )
    matchRef.current = base
    setMatch(base)
    clearDestructionEffects()
    setTurnTimeLeft(
      config.isOnline && onlineAuthorityRef.current
        ? getDisplayedTurnTimeMs(onlineAuthorityRef.current, performance.now()) / 1_000
        : config.turnSeconds,
    )
    setScreen('countdown')

    for (const step of MATCH_COUNTDOWN_STEPS) {
      if (runId !== countdownRunRef.current) return
      setCountdown(step.label)
      await sleep(step.durationMs)
    }

    if (runId !== countdownRunRef.current) return
    const authority = onlineAuthorityRef.current
    if (config.isOnline && (!authority || authority.status === 'sync-lost')) return
    const started = config.isOnline
      ? applyOnlinePresentation(
          { ...(matchRef.current ?? base), phase: 'battle' },
          authority!.canonical,
          [],
        )
      : startOfflineMatch(base)
    applyEngineResult(started)
    setTurnTimeLeft(
      config.isOnline
        ? getDisplayedTurnTimeMs(authority!, performance.now()) / 1_000
        : config.turnSeconds,
    )
    setScreen('battle')
  }, [applyEngineResult, clearDestructionEffects, setScreen])

  const enterSyncLost = useCallback((detail: string) => {
    if (!tryMarkOnlineTerminalScreen(screenRef, 'sync-lost')) return
    const authority = onlineAuthorityRef.current
    if (authority) {
      onlineAuthorityRef.current = {
        ...authority,
        status: 'sync-lost',
        syncLostReason: detail,
        pending: null,
      }
    }
    countdownRunRef.current += 1
    setStatus({ tone: 'error', label: 'SYNC LOST', detail })
    setAnnouncement('')
    setScreen('sync-lost')
    setOnlineInputPending(false)
  }, [screenRef, setScreen, setStatus])

  const onClientEvent = useCallback((event: ClientEvent) => {
    if (event.type === 'open') {
      setStatus({
        tone: 'working',
        label: 'CONNECTED',
        detail: 'Syncing your player profile…',
      })
      return
    }

    if (event.type === 'close') {
      if (manualCloseRef.current || screenRef.current === 'intro') {
        manualCloseRef.current = false
        return
      }
      if (!tryMarkOnlineTerminalScreen(screenRef, 'disconnected')) return
      const authority = onlineAuthorityRef.current
      if (authority) onlineAuthorityRef.current = { ...authority, pending: null }
      setOnlineInputPending(false)
      setStatus({
        tone: 'error',
        label: 'CONNECTION LOST',
        detail: event.reason,
      })
      setScreen('disconnected')
      return
    }

    if (event.type === 'error') {
      setStatus({ tone: 'error', label: 'CONNECTION ERROR', detail: event.message })
      return
    }

    if (event.type === 'sync-lost') {
      enterSyncLost(event.message)
      return
    }

    if (event.type === 'assigned-id') {
      setClientId(event.clientId)
      setStatus({
        tone: 'working',
        label: 'CONNECTED',
        detail: `Client #${event.clientId} assigned. Syncing player profile…`,
      })
      return
    }

    if (event.type === 'users') {
      setUsers(event.users)
      return
    }

    if (handleLobbyClientEvent(event)) return

    if (event.type === 'match-found') {
      clearForMatchFound()
      setOnlineRules(event.config)
      setReadyLocked(false)
      setStatus({
        tone: 'success',
        label: 'MATCH FOUND',
        detail: 'Opponent connected. Ready up.',
      })
      setAnnouncement('')
      setScreen('ready')
      return
    }

    if (event.type === 'game-start') {
      const localClientId = clientRef.current?.clientId
      if (localClientId === null || localClientId === undefined) {
        enterSyncLost('The match started before client identity was assigned.')
        return
      }
      let authority: OnlineAuthorityState
      try {
        authority = createOnlineAuthority(
          event.descriptor,
          event.firstPlayerId,
          localClientId,
          performance.now(),
        )
      } catch {
        enterSyncLost('This match mode cannot be safely started.')
        return
      }
      onlineAuthorityRef.current = authority
      setOnlineInputPending(false)
      setOnlineRules(event.descriptor.config)
      const config = createOnlineMatchConfig(event.descriptor.config)
      const presented = createOnlinePresentedState(
        config,
        authority.canonical,
        authority.localSeat,
      )
      setStatus({
        tone: 'success',
        label: 'STARTING',
        detail: 'Both players are ready.',
      })
      void beginCountdown(config, presented.isMyTurn, presented)
      return
    }

    if (event.type === 'game-update') {
      if (isOnlineTerminalScreen(screenRef.current)) return
      const authority = onlineAuthorityRef.current
      const currentMatch = matchRef.current
      if (!authority || !currentMatch) {
        enterSyncLost('An authoritative update arrived before the match was ready.')
        return
      }
      const result = applyOnlineUpdate(authority, event.update, performance.now())
      onlineAuthorityRef.current = result.state
      setOnlineInputPending(result.state.pending !== null)
      if (result.state.status === 'sync-lost') {
        enterSyncLost(result.state.syncLostReason ?? 'The match could not stay synchronized.')
        return
      }
      setTurnTimeLeft(getDisplayedTurnTimeMs(result.state, performance.now()) / 1_000)
      if (result.message) setAnnouncement(result.message)
      if (event.update.status === 'accepted') {
        applyEngineResult(applyOnlinePresentation(
          currentMatch,
          result.state.canonical,
          result.events,
          result.clearLocalSelection,
        ))
      }
      return
    }

    if (!matchRef.current) return

    if (event.type === 'opponent-disconnected') {
      if (!tryMarkOnlineTerminalScreen(screenRef, 'disconnected')) return
      const authority = onlineAuthorityRef.current
      if (authority) onlineAuthorityRef.current = { ...authority, pending: null }
      setOnlineInputPending(false)
      setStatus({
        tone: 'error',
        label: 'OPPONENT LEFT',
        detail: 'Your opponent disconnected.',
      })
      setScreen('disconnected')
    }
  }, [
    applyEngineResult,
    beginCountdown,
    enterSyncLost,
    clearForMatchFound,
    screenRef,
    setScreen,
    setStatus,
    handleLobbyClientEvent,
  ])

  const onTimeout = useCallback(() => {
    if (!matchRef.current) return
    if (!shouldResolveTimeoutLocally(matchRef.current.config)) return
    applyEngineResult(forceOfflineTimeout(matchRef.current))
  }, [applyEngineResult])

  const onAiTurn = useCallback(() => {
    if (!matchRef.current) return
    applyEngineResult(playOfflineBotTurn(matchRef.current))
  }, [applyEngineResult])

  useEffect(() => {
    if (screen !== 'battle' || !match || match.phase !== 'battle') return
    if (match.config.isOnline) {
      const id = window.setInterval(() => {
        const authority = onlineAuthorityRef.current
        if (!authority) return
        setTurnTimeLeft(getDisplayedTurnTimeMs(authority, performance.now()) / 1_000)
      }, 100)
      return () => window.clearInterval(id)
    }
    if (!match.isMyTurn) return
    const startedAt = performance.now()
    const id = window.setInterval(() => {
      const remaining = Math.max(
        0,
        match.config.turnSeconds - (performance.now() - startedAt) / 1000,
      )
      setTurnTimeLeft(remaining)
      if (remaining <= 0) {
        window.clearInterval(id)
        onTimeout()
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [screen, match, onTimeout])

  useEffect(() => {
    if (
      screen !== 'battle' ||
      !match ||
      match.phase !== 'battle' ||
      match.isMyTurn ||
      !match.config.hasAI ||
      match.config.isOnline
    ) return
    const id = window.setTimeout(() => onAiTurn(), 650)
    return () => window.clearTimeout(id)
  }, [screen, match, onAiTurn])

  const closeClient = useCallback(() => {
    const client = clientRef.current
    if (!client) return

    manualCloseRef.current = true
    try {
      client.cancelMatchmaking()
    } catch {
      // The socket may already be closed.
    }
    client.close('Returning to Hidden')
    clientRef.current = null
    onlineAuthorityRef.current = null
    setOnlineInputPending(false)
  }, [])

  const clearAnnouncement = useCallback(() => setAnnouncement(''), [])

  const resetForAccountChange = useCallback((shouldClearAnnouncement = false) => {
    countdownRunRef.current += 1
    closeClient()
    setMatch(null)
    matchRef.current = null
    onlineAuthorityRef.current = null
    setOnlineInputPending(false)
    setUsers([])
    setReadyLocked(false)
    if (shouldClearAnnouncement) setAnnouncement('')
  }, [closeClient])

  const resetForHome = useCallback(() => {
    countdownRunRef.current += 1
    closeClient()
    setUsers([])
    setReadyLocked(false)
    setMatch(null)
    matchRef.current = null
    onlineAuthorityRef.current = null
    setOnlineInputPending(false)
    setCountdown('3')
    setTurnTimeLeft(0)
    setSearchSeconds(0)
    setClientId(null)
    clearDestructionEffects()
    setAnnouncement('')
  }, [clearDestructionEffects, closeClient])

  const resetForNavigation = useCallback((current: Screen, isOnlineMatch: boolean) => {
    const leavingActiveMatch =
      current === 'countdown' ||
      current === 'battle' ||
      current === 'results' ||
      current === 'disconnected' ||
      current === 'sync-lost'

    if (leavingActiveMatch) {
      countdownRunRef.current += 1
      setMatch(null)
      matchRef.current = null
      onlineAuthorityRef.current = null
      setOnlineInputPending(false)
      setCountdown('3')
      setTurnTimeLeft(0)
      clearDestructionEffects()
    }

    if (current === 'matchmaking' || current === 'ready' || isOnlineMatch) {
      closeClient()
      setUsers([])
      setReadyLocked(false)
      setSearchSeconds(0)
      setClientId(null)
    }

    setAnnouncement('')
  }, [clearDestructionEffects, closeClient])

  const connectAndEnterLobby = useCallback(async (username: string) => {
    const client = createClient()
    client.subscribe(onClientEvent)
    clientRef.current = client

    await client.connect(wsUrl())
    setStatus({
      tone: 'working',
      label: 'CONNECTED',
      detail: `Registering ${username}…`,
    })
    const named = await client.sendUserName(username)
    if (!named) throw new Error('Username rejected.')
    const joined = await client.joinRoom(LOBBY_ROOM_ID)
    if (!joined) throw new Error('Could not join the lobby.')
    return client
  }, [createClient, onClientEvent, setStatus])

  const resetOnlineState = useCallback(() => {
    setUsers([])
    setReadyLocked(false)
    setSearchSeconds(0)
    setAnnouncement('')
    onlineAuthorityRef.current = null
    setOnlineInputPending(false)
    setOnlineRules(null)
    clearLobbyError()
  }, [clearLobbyError])

  const startOffline = useCallback(async (config: GameConfig) => {
    setStatus({ tone: 'success', label: 'OFFLINE', detail: 'Practice bot ready.' })
    setAnnouncement('Battle starting.')
    await beginCountdown(makeConfig(config, false, true), true)
  }, [beginCountdown, setStatus])

  const hostGame = useCallback(async (
    username: string,
    config: GameConfig,
    isPrivate: boolean,
  ) => {
    resetOnlineState()
    beginHosting()
    setStatus({
      tone: 'working',
      label: 'CONNECTING',
      detail: 'Reaching the Hidden server…',
    })
    setScreen('lobby-create')
    try {
      const client = await connectAndEnterLobby(username)
      client.createLobbyGame(config, isPrivate)
      setStatus({
        tone: 'working',
        label: 'HOSTING',
        detail: 'Waiting for a player to join…',
      })
    } catch (cause) {
      closeClient()
      setScreen('online-menu')
      setStatus({
        tone: 'error',
        label: 'OFFLINE',
        detail: cause instanceof Error ? cause.message : 'Could not host a game.',
      })
    }
  }, [
    closeClient,
    connectAndEnterLobby,
    beginHosting,
    resetOnlineState,
    setScreen,
    setStatus,
  ])

  const findGames = useCallback(async (username: string) => {
    resetOnlineState()
    beginBrowsing()
    setStatus({
      tone: 'working',
      label: 'CONNECTING',
      detail: 'Reaching the Hidden server…',
    })
    setScreen('lobby-find')
    try {
      const client = await connectAndEnterLobby(username)
      client.subscribeLobby(true)
      setStatus({ tone: 'neutral', label: 'LOBBY', detail: 'Pick a game to join.' })
    } catch (cause) {
      closeClient()
      setScreen('online-menu')
      setStatus({
        tone: 'error',
        label: 'OFFLINE',
        detail: cause instanceof Error ? cause.message : 'Could not open the lobby.',
      })
    }
  }, [
    closeClient,
    connectAndEnterLobby,
    beginBrowsing,
    resetOnlineState,
    setScreen,
    setStatus,
  ])

  const leaveLobbyScreen = useCallback(() => {
    clientRef.current?.cancelLobbyGame()
    closeClient()
    leaveLobby()
    setScreen('online-menu')
    setStatus({ tone: 'neutral', label: 'ONLINE', detail: 'Choose how to play.' })
  }, [closeClient, leaveLobby, setScreen, setStatus])

  const startOnline = useCallback(async (
    username: string,
    proposedConfig?: GameConfig,
  ) => {
    setUsers([])
    setReadyLocked(false)
    setSearchSeconds(0)
    setStatus({
      tone: 'working',
      label: 'CONNECTING',
      detail: 'Reaching the Hidden server…',
    })
    setAnnouncement('')
    onlineAuthorityRef.current = null
    setOnlineInputPending(false)
    setOnlineRules(null)
    setScreen('matchmaking')

    const client = createClient()
    client.subscribe(onClientEvent)
    clientRef.current = client

    try {
      await client.connect(wsUrl())
      setStatus({
        tone: 'working',
        label: 'CONNECTED',
        detail: `Registering ${username}…`,
      })
      const named = await client.sendUserName(username)
      if (!named) throw new Error('Username rejected.')
      setStatus({
        tone: 'working',
        label: 'JOINING',
        detail: 'Entering the matchmaking lobby…',
      })
      const joined = await client.joinRoom(LOBBY_ROOM_ID)
      if (!joined) throw new Error('Could not join the lobby.')
      client.startMatchmaking(proposedConfig)
      setStatus({
        tone: 'working',
        label: 'SEARCHING',
        detail: 'Looking for an opponent · 00:00',
      })
    } catch (cause) {
      closeClient()
      setStatus({
        tone: 'error',
        label: 'CONNECTION ERROR',
        detail: cause instanceof Error ? cause.message : 'Connection failed.',
      })
      setScreen('online-menu')
    }
  }, [createClient, closeClient, onClientEvent, setScreen, setStatus])

  const joinLobbyGame = useCallback((code: string) => {
    clientRef.current?.joinLobbyGame(code)
  }, [])

  const ready = useCallback(() => {
    setReadyLocked(true)
    setStatus({
      tone: 'working',
      label: 'READY',
      detail: 'Waiting for your opponent…',
    })
    setAnnouncement('')
    clientRef.current?.sendReady(true)
  }, [setStatus])

  const playAgain = useCallback(() => {
    if (!match) return

    restartMatch({
      config: match.config,
      sendReady: (isReady) => clientRef.current?.sendReady(isReady),
      showReady: () => {
        setReadyLocked(true)
        setStatus({
          tone: 'working',
          label: 'READY',
          detail: 'Waiting for your opponent…',
        })
        setAnnouncement('')
        setScreen('ready')
      },
      beginLocalMatch: (config) => {
        void beginCountdown(config, true)
      },
    })
  }, [beginCountdown, match, setScreen, setStatus])

  const selectMatchSymbol = useCallback((symbol: ClassicSymbol) => {
    if (!matchRef.current) return
    const next = selectSymbol(matchRef.current, symbol)
    matchRef.current = next
    setMatch(next)
  }, [])

  const sendOnlineCommand = useCallback((command: ClientGameCommand) => {
    const authority = onlineAuthorityRef.current
    if (!authority) {
      enterSyncLost('The online match authority is unavailable.')
      return
    }
    const queued = queueOnlineCommand(authority, command)
    if (!queued.envelope) {
      if (authority.pending) setAnnouncement('Waiting for the server…')
      return
    }
    onlineAuthorityRef.current = queued.state
    setOnlineInputPending(true)
    try {
      const client = clientRef.current
      if (!client) throw new Error('WebSocket client is unavailable.')
      client.sendGameCommand(queued.envelope)
    } catch {
      enterSyncLost('The action could not be delivered to the server.')
    }
  }, [enterSyncLost])

  const selectCell = useCallback((index: number) => {
    if (!matchRef.current) return
    if (matchRef.current.shieldSelectionMode) {
      if (matchRef.current.config.isOnline) {
        sendOnlineCommand({ type: 'select-shield-target', locationId: index })
      } else {
        applyEngineResult(applyOfflineShieldSelection(matchRef.current, index))
      }
      return
    }
    if (!matchRef.current.selectedSymbol) {
      setAnnouncement('Pick rock, paper, or scissors first.')
      return
    }
    if (matchRef.current.config.isOnline) {
      sendOnlineCommand({
        type: 'place',
        locationId: index,
        symbol: matchRef.current.selectedSymbol,
      })
    } else {
      applyEngineResult(applyOfflineLocalMove(matchRef.current, index))
    }
  }, [applyEngineResult, sendOnlineCommand])

  const activatePowerup = useCallback((powerup: PowerupKey) => {
    if (!matchRef.current) return
    if (matchRef.current.config.isOnline) {
      sendOnlineCommand({ type: 'activate-powerup', powerup })
    } else {
      applyEngineResult(applyOfflinePowerup(matchRef.current, powerup))
    }
  }, [applyEngineResult, sendOnlineCommand])

  const endReveal = useCallback(() => {
    if (!matchRef.current?.playerPowerups.revealActive) return
    if (matchRef.current.config.isOnline) {
      sendOnlineCommand({ type: 'end-reveal' })
    } else {
      applyEngineResult(applyOfflineRevealEnd(matchRef.current))
    }
  }, [applyEngineResult, sendOnlineCommand])

  /*
   * The offline window. Online, `MatchCoordinator` owns this and the client
   * only ever asks to close early; offline the client *is* the authority, so it
   * arms the same window itself. Keyed on the flag rather than on the
   * activation, so a reveal cleared by placing tears the timer down with it.
   */
  useEffect(() => {
    if (!match?.playerPowerups.revealActive || match.config.isOnline) return
    const id = window.setTimeout(endReveal, match.config.revealSeconds * 1000)
    return () => window.clearTimeout(id)
  }, [
    match?.playerPowerups.revealActive,
    match?.config.isOnline,
    match?.config.revealSeconds,
    endReveal,
  ])

  return {
    onlineRules,
    match,
    announcement,
    users,
    readyLocked,
    countdown,
    searchSeconds,
    turnTimeLeft,
    clientId,
    onlineInputPending,
    clearAnnouncement,
    resetForAccountChange,
    resetForHome,
    resetForNavigation,
    startOffline,
    hostGame,
    findGames,
    leaveLobbyScreen,
    startOnline,
    joinLobbyGame,
    ready,
    playAgain,
    selectSymbol: selectMatchSymbol,
    selectCell,
    activatePowerup,
    endReveal,
  }
}
