import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import './animations/turn-focus.css'
import paperIcon from './assets/icons/battle/move-paper.png'
import rockIcon from './assets/icons/battle/move-rock.png'
import scissorsIcon from './assets/icons/battle/move-scissors.png'
import exitDoorIcon from './assets/icons/exit-door.png'
import {
  AuthApiError,
  createAuthClient,
  type AuthUser,
} from './auth/authClient'
import type { AccountMode } from './auth/accountValidation'
import { AccountForm } from './components/AccountForm'
import { BoardGrid, type CellDestructionEffect } from './components/BoardGrid'
import { PowerupTray } from './components/PowerupTray'
import { ProfileMenu } from './components/ProfileMenu'
import {
  ActionChoice,
  AdvancedSettings,
  GameMasthead,
  GuestIdentity,
  MatchRulesSummary,
  OnlineAdminSettings,
  StatusStrip,
  type UiStatus,
} from './components/PregameUi'
import { COLOR_BLUE, COLOR_GREEN, COLOR_RED } from './game/constants'
import {
  applyOnlinePresentation,
  applyOfflineLocalMove,
  applyOfflinePowerup,
  applyOfflineShieldSelection,
  createOfflineState,
  createOnlinePresentedState,
  forceOfflineTimeout,
  playOfflineBotTurn,
  startOfflineMatch,
} from './game/coreAdapter'
import {
  selectColor,
} from './game/engine'
import { NetworkClient, resolveWebSocketUrl, type ClientEvent } from './game/networkClient'
import {
  DEFAULT_MATCH_RULES,
  type MatchRules,
} from './game/matchRules'
import {
  createOnlineMatchConfig,
  restartMatch,
  shouldResolveTimeoutLocally,
} from './game/onlineMatch'
import {
  applyOnlineUpdate,
  createOnlineAuthority,
  getDisplayedTurnTimeMs,
  queueOnlineCommand,
  type OnlineAuthorityState,
} from './game/onlineAuthority'
import { LOBBY_ROOM_ID, type UserEntry } from './game/protocol'
import type { EngineResult, GameState, MatchConfig, PaintColor, PowerupKey } from './game/types'
import {
  createGuestName,
  getBackTarget,
  getOpponentName,
  getScoreCountLabels,
  resolvePlayerName,
  shouldPromptMoveChoice,
  shouldShowOpponentBoard,
  type Screen,
} from './game/viewModel'

const pieces = [
  { color: COLOR_GREEN as PaintColor, label: 'Rock', icon: rockIcon },
  { color: COLOR_BLUE as PaintColor, label: 'Paper', icon: paperIcon },
  { color: COLOR_RED as PaintColor, label: 'Scissors', icon: scissorsIcon },
]

const symbolByColor = {
  [COLOR_GREEN]: 'rock',
  [COLOR_BLUE]: 'paper',
  [COLOR_RED]: 'scissors',
} as const

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
type DestructionEffectMap = Partial<Record<number, CellDestructionEffect>>
const accountClient = createAuthClient()

const wsUrl = () =>
  resolveWebSocketUrl({
    override: import.meta.env.VITE_WS_URL,
    protocol: window.location.protocol,
    host: window.location.host,
  })

function makeConfig(
  rounds: number,
  turnSeconds: number,
  blindMode: boolean,
  isOnline: boolean,
  hasAI: boolean,
): MatchConfig {
  return { rounds, turnSeconds, blindMode, isOnline, hasAI }
}

interface BrushButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  tone?: 'yellow' | 'white' | 'red'
}

function BrushButton({ children, className = '', tone = 'yellow', type = 'button', ...props }: BrushButtonProps) {
  return (
    <button type={type} className={`brush-button brush-button-${tone} ${className}`} {...props}>
      <span>{children}</span>
    </button>
  )
}

function App() {
  const [screen, setScreen] = useState<Screen>('intro')
  const [guestUsername] = useState(createGuestName)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authHydrated, setAuthHydrated] = useState(false)
  const [authMode, setAuthMode] = useState<AccountMode>('register')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [rounds, setRounds] = useState(6)
  const [turnSeconds, setTurnSeconds] = useState(10)
  const [blindMode, setBlindMode] = useState(true)
  const [onlineRules, setOnlineRules] = useState<MatchRules | null>(null)
  const [match, setMatch] = useState<GameState | null>(null)
  const [status, setStatus] = useState<UiStatus>({
    tone: 'neutral',
    label: 'GUEST',
    detail: 'Choose how you want to play.',
  })
  const [announcement, setAnnouncement] = useState('')
  const [users, setUsers] = useState<UserEntry[]>([])
  const [readyLocked, setReadyLocked] = useState(false)
  const [countdown, setCountdown] = useState('3')
  const [searchSeconds, setSearchSeconds] = useState(0)
  const [turnTimeLeft, setTurnTimeLeft] = useState(0)
  const [clientId, setClientId] = useState<number | null>(null)
  const [onlineInputPending, setOnlineInputPending] = useState(false)
  const [playerDestructionEffects, setPlayerDestructionEffects] = useState<DestructionEffectMap>({})
  const [opponentDestructionEffects, setOpponentDestructionEffects] = useState<DestructionEffectMap>({})

  const clientRef = useRef<NetworkClient | null>(null)
  const matchRef = useRef<GameState | null>(null)
  const screenRef = useRef<Screen>('intro')
  const manualCloseRef = useRef(false)
  const onlineAuthorityRef = useRef<OnlineAuthorityState | null>(null)
  const destructionSequenceRef = useRef(0)
  const destructionTimeoutsRef = useRef<number[]>([])
  const countdownRunRef = useRef(0)
  const username = resolvePlayerName(authUser?.username, guestUsername)

  useEffect(() => {
    let active = true

    void accountClient
      .getSession()
      .then((user) => {
        if (!active) return
        setAuthUser(user)
        if (user) {
          setStatus({
            tone: 'success',
            label: 'ACCOUNT',
            detail: `Signed in as ${user.username}.`,
          })
        }
      })
      .catch(() => {
        // Account availability must never block guest or offline play.
      })
      .finally(() => {
        if (active) setAuthHydrated(true)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    matchRef.current = match
  }, [match])

  useEffect(() => {
    screenRef.current = screen
  }, [screen])

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

  useEffect(
    () => () => {
      for (const timeoutId of destructionTimeoutsRef.current) {
        window.clearTimeout(timeoutId)
      }
    },
    [],
  )

  const queueDestructionEffect = useCallback((board: 'player' | 'opponent', index: number) => {
    const id = ++destructionSequenceRef.current
    const setter = board === 'player' ? setPlayerDestructionEffects : setOpponentDestructionEffects
    const tone: CellDestructionEffect['tone'] = board === 'player' ? 'loss' : 'victory'

    setter((current) => ({ ...current, [index]: { id, tone } }))
    const timeoutId = window.setTimeout(() => {
      setter((current) => {
        if (current[index]?.id !== id) return current
        const next = { ...current }
        delete next[index]
        return next
      })
    }, 620)
    destructionTimeoutsRef.current.push(timeoutId)
  }, [])

  const applyEngineResult = useCallback((result: EngineResult) => {
    matchRef.current = result.state
    setMatch(result.state)
    const messages = result.events.filter((event) => event.type === 'announcement').map((event) => event.message)
    if (messages.length > 0) setAnnouncement(messages.join(' / '))

    for (const event of result.events) {
      if (event.type === 'cell-destroyed') queueDestructionEffect(event.board, event.index)
      if (event.type === 'game-over') {
        countdownRunRef.current += 1
        setScreen('results')
      }
    }
  }, [queueDestructionEffect])

  const beginCountdown = useCallback(
    async (
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
      setPlayerDestructionEffects({})
      setOpponentDestructionEffects({})
      setTurnTimeLeft(
        config.isOnline && onlineAuthorityRef.current
          ? getDisplayedTurnTimeMs(onlineAuthorityRef.current, performance.now()) / 1_000
          : config.turnSeconds,
      )
      setScreen('countdown')

      for (const value of ['3', '2', '1', 'GO!']) {
        if (runId !== countdownRunRef.current) return
        setCountdown(value)
        await sleep(value === 'GO!' ? 520 : 700)
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
    },
    [applyEngineResult],
  )

  const enterSyncLost = useCallback((detail: string) => {
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
  }, [])

  const onClientEvent = useCallback(
    (event: ClientEvent) => {
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
        setStatus({
          tone: 'error',
          label: 'CONNECTION LOST',
          detail: event.reason,
        })
        setScreen('disconnected')
        return
      }

      if (event.type === 'error') {
        setStatus({
          tone: 'error',
          label: 'CONNECTION ERROR',
          detail: event.message,
        })
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

      if (event.type === 'match-found') {
        setOnlineRules(event.rules)
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
        setOnlineRules(event.descriptor.rules)
        const config = createOnlineMatchConfig(event.descriptor.rules)
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
          applyEngineResult(
            applyOnlinePresentation(
              currentMatch,
              result.state.canonical,
              result.events,
              result.clearLocalSelection,
            ),
          )
        }
        return
      }

      if (!matchRef.current) return

      if (event.type === 'opponent-disconnected') {
        setStatus({
          tone: 'error',
          label: 'OPPONENT LEFT',
          detail: 'Your opponent disconnected.',
        })
        setScreen('disconnected')
      }
    },
    [applyEngineResult, beginCountdown, enterSyncLost],
  )

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
      const remaining = Math.max(0, match.config.turnSeconds - (performance.now() - startedAt) / 1000)
      setTurnTimeLeft(remaining)
      if (remaining <= 0) {
        window.clearInterval(id)
        onTimeout()
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [screen, match, onTimeout])

  useEffect(() => {
    if (screen !== 'battle' || !match || match.phase !== 'battle' || match.isMyTurn || !match.config.hasAI || match.config.isOnline) return
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

  const openAccount = useCallback((mode: AccountMode) => {
    countdownRunRef.current += 1
    closeClient()
    setMatch(null)
    matchRef.current = null
    onlineAuthorityRef.current = null
    setOnlineInputPending(false)
    setUsers([])
    setReadyLocked(false)
    setAuthMode(mode)
    setAuthError(null)
    setStatus({
      tone: 'neutral',
      label: 'ACCOUNT',
      detail: mode === 'register' ? 'Create a permanent player name.' : 'Return to your account.',
    })
    setScreen('account')
  }, [closeClient])

  const submitAccount = useCallback(
    async (submittedUsername: string, password: string) => {
      setAuthBusy(true)
      setAuthError(null)
      try {
        const user =
          authMode === 'register'
            ? await accountClient.register(submittedUsername, password)
            : await accountClient.login(submittedUsername, password)
        setAuthUser(user)
        setStatus({
          tone: 'success',
          label: 'ACCOUNT',
          detail: `Signed in as ${user.username}.`,
        })
        setScreen('mode-select')
      } catch (cause) {
        const message =
          cause instanceof AuthApiError
            ? cause.message
            : 'Accounts are temporarily unavailable.'
        setAuthError(message)
        setStatus({
          tone: 'error',
          label: 'ACCOUNT ERROR',
          detail: message,
        })
        throw cause
      } finally {
        setAuthBusy(false)
      }
    },
    [authMode],
  )

  const logout = useCallback(async () => {
    setAuthBusy(true)
    setAuthError(null)
    try {
      await accountClient.logout()
      closeClient()
      setAuthUser(null)
      setUsers([])
      setReadyLocked(false)
      setMatch(null)
      matchRef.current = null
      setStatus({
        tone: 'neutral',
        label: 'GUEST',
        detail: `Playing as ${guestUsername}.`,
      })
      setAnnouncement('')
      setScreen('intro')
    } catch (cause) {
      const message =
        cause instanceof AuthApiError
          ? cause.message
          : 'Accounts are temporarily unavailable.'
      setAuthError(message)
      setStatus({
        tone: 'error',
        label: 'LOGOUT ERROR',
        detail: message,
      })
    } finally {
      setAuthBusy(false)
    }
  }, [closeClient, guestUsername])

  const backHome = useCallback(() => {
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
    setPlayerDestructionEffects({})
    setOpponentDestructionEffects({})
    setStatus({
      tone: 'neutral',
      label: authUser ? 'ACCOUNT' : 'GUEST',
      detail: authUser
        ? `Signed in as ${username}.`
        : 'Choose how you want to play.',
    })
    setAnnouncement('')
    setScreen('intro')
  }, [authUser, closeClient, username])

  const navigateBack = useCallback(() => {
    const current = screenRef.current
    const currentMatch = matchRef.current
    const isOnlineMatch =
      current === 'disconnected' ||
      current === 'sync-lost' ||
      currentMatch?.config.isOnline === true
    const target = getBackTarget(current, isOnlineMatch)

    if (target === 'intro') {
      backHome()
      return
    }

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
      setPlayerDestructionEffects({})
      setOpponentDestructionEffects({})
    }

    if (current === 'matchmaking' || current === 'ready' || isOnlineMatch) {
      closeClient()
      setUsers([])
      setReadyLocked(false)
      setSearchSeconds(0)
      setClientId(null)
    }

    setAnnouncement('')
    const nextStatus: UiStatus =
      target === 'online-menu'
        ? { tone: 'neutral', label: 'ONLINE', detail: `Ready to connect as ${username}.` }
        : target === 'offline-setup'
          ? { tone: 'success', label: 'OFFLINE', detail: 'Practice bot ready.' }
          : { tone: 'neutral', label: 'GUEST', detail: `Playing as ${username}.` }

    setStatus(nextStatus)
    setScreen(target)
  }, [backHome, closeClient, username])

  const startOffline = async () => {
    setStatus({
      tone: 'success',
      label: 'OFFLINE',
      detail: 'Practice bot ready.',
    })
    setAnnouncement('Battle starting.')
    await beginCountdown(makeConfig(rounds, turnSeconds, blindMode, false, true), true)
  }

  const startOnline = async () => {
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

    const client = new NetworkClient()
    client.subscribe((event) => onClientEvent(event))
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
      client.startMatchmaking(
        authUser?.role === 'admin'
          ? { rounds, turnSeconds, blindMode }
          : undefined,
      )
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
  }

  const onReady = () => {
    setReadyLocked(true)
    setStatus({
      tone: 'working',
      label: 'READY',
      detail: 'Waiting for your opponent…',
    })
    setAnnouncement('')
    clientRef.current?.sendReady(true)
  }

  const onAgain = () => {
    if (!match) return

    restartMatch({
      config: match.config,
      sendReady: (ready) => clientRef.current?.sendReady(ready),
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
  }

  const onSelectColor = (color: PaintColor) => {
    if (!matchRef.current) return
    const next = selectColor(matchRef.current, color)
    matchRef.current = next
    setMatch(next)
  }

  const sendOnlineCommand = (
    command:
      | { type: 'place'; locationId: number; symbol: 'rock' | 'paper' | 'scissors' }
      | { type: 'activate-powerup'; powerup: PowerupKey }
      | { type: 'select-shield-target'; locationId: number },
  ) => {
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
  }

  const onCellSelect = (index: number) => {
    if (!matchRef.current) return
    if (matchRef.current.shieldSelectionMode) {
      if (matchRef.current.config.isOnline) {
        sendOnlineCommand({ type: 'select-shield-target', locationId: index })
      } else {
        applyEngineResult(applyOfflineShieldSelection(matchRef.current, index))
      }
      return
    }
    if (!matchRef.current.selectedColor) {
      setAnnouncement('Pick rock, paper, or scissors first.')
      return
    }
    if (matchRef.current.config.isOnline) {
      sendOnlineCommand({
        type: 'place',
        locationId: index,
        symbol: symbolByColor[matchRef.current.selectedColor],
      })
    } else {
      applyEngineResult(applyOfflineLocalMove(matchRef.current, index))
    }
  }

  const onPowerup = (powerup: PowerupKey) => {
    if (!matchRef.current) return
    if (matchRef.current.config.isOnline) {
      sendOnlineCommand({ type: 'activate-powerup', powerup })
    } else {
      applyEngineResult(applyOfflinePowerup(matchRef.current, powerup))
    }
  }

  const opponentName = getOpponentName(users, clientId, match)
  const showOpponent = shouldShowOpponentBoard(match, screen)
  const visiblePlayerDestructionEffects = {
    ...opponentDestructionEffects,
    ...playerDestructionEffects,
  }
  const searchClock = `${Math.floor(searchSeconds / 60).toString().padStart(2, '0')}:${(searchSeconds % 60)
    .toString()
    .padStart(2, '0')}`
  const inlineStatus =
    screen === 'matchmaking' && status.label === 'SEARCHING'
      ? { ...status, detail: `Looking for an opponent · ${searchClock}` }
      : status
  const chromeStatus: UiStatus =
    screen === 'results' && match?.result
      ? {
          tone: match.result.outcome === 'loss' ? 'error' : 'success',
          label: 'MATCH COMPLETE',
          detail: `${username} ${match.result.playerScore} · ${opponentName} ${match.result.opponentScore}`,
        }
      : screen === 'battle' && match
        ? {
            tone: match.isMyTurn ? 'success' : 'working',
            label: match.config.isOnline ? 'ONLINE' : 'OFFLINE',
            detail: match.config.isOnline
              ? `Connected to ${opponentName}.`
              : 'Practice bot connected.',
          }
        : screen === 'countdown'
          ? {
              tone: 'working',
              label: 'STARTING',
              detail: 'Battle begins now.',
            }
          : inlineStatus
  const statusText =
    screen === 'battle' && match
      ? match.isMyTurn
        ? match.shieldSelectionMode
          ? 'Choose a tile to shield.'
          : 'Your Turn'
        : `Waiting for ${opponentName}`
      : status.detail
  const awaitingMoveChoice = shouldPromptMoveChoice(match, screen)
  const playerScoreCountLabels = match
    ? getScoreCountLabels(match.playerGrid.cells)
    : {}
  const opponentScoreCountLabels = match
    ? getScoreCountLabels(match.opponentGrid.cells)
    : {}
  const accountChangeLocked =
    screen === 'matchmaking' ||
    screen === 'ready' ||
    screen === 'countdown' ||
    screen === 'battle' ||
    screen === 'results'

  return (
    <main className={`unity-shell unity-${screen}`}>
      {screen !== 'intro' ? (
        <header className="top-chrome">
          <nav className="game-navbar" aria-label="Game navigation">
            <button
              type="button"
              className="nav-brush-button nav-back-button"
              onClick={navigateBack}
              aria-label="Go back"
            >
              <span aria-hidden="true">←</span>
              BACK
            </button>
            <StatusStrip status={chromeStatus} chrome />
            {authUser ? (
              <ProfileMenu
                username={authUser.username}
                busy={authBusy}
                disabled={accountChangeLocked || screen === 'account'}
                onSignOut={() => void logout()}
              />
            ) : (
              <button
                type="button"
                className="nav-brush-button nav-account-button"
                aria-label="Sign in"
                disabled={authBusy || accountChangeLocked || screen === 'account'}
                onClick={() => openAccount('login')}
              >
                {authBusy ? 'WAIT...' : 'SIGN IN'}
              </button>
            )}
          </nav>
        </header>
      ) : null}

      {screen === 'intro' ? (
        <section className="welcome-screen">
          <GameMasthead />
          <div className="action-grid welcome-actions">
            {!authHydrated ? (
              <ActionChoice
                label="CHECKING SESSION"
                description="Looking for a saved account."
                disabled
              />
            ) : authUser ? (
              <>
                <ActionChoice
                  label={`CONTINUE AS ${authUser.username}`}
                  description="Use your permanent player identity."
                  onClick={() => {
                    setStatus({
                      tone: 'success',
                      label: 'ACCOUNT',
                      detail: `Playing as ${authUser.username}.`,
                    })
                    setScreen('mode-select')
                  }}
                />
                <ActionChoice
                  label="LOG OUT"
                  description="Return to guest play on this browser."
                  tone="secondary"
                  disabled={authBusy}
                  onClick={() => void logout()}
                />
              </>
            ) : (
              <>
                <ActionChoice
                  label="PLAY AS GUEST"
                  description={`Jump in now as ${guestUsername}.`}
                  onClick={() => {
                    setStatus({
                      tone: 'neutral',
                      label: 'GUEST',
                      detail: `Playing as ${guestUsername}.`,
                    })
                    setScreen('mode-select')
                  }}
                />
                <ActionChoice
                  label="CREATE ACCOUNT"
                  description="Claim a permanent player name."
                  tone="secondary"
                  onClick={() => openAccount('register')}
                />
              </>
            )}
          </div>
        </section>
      ) : null}

      {screen === 'account' ? (
        <section className="setup-screen account-screen">
          <GameMasthead compact />
          <AccountForm
            mode={authMode}
            busy={authBusy}
            error={authError}
            onModeChange={openAccount}
            onSubmit={submitAccount}
          />
        </section>
      ) : null}

      {screen === 'mode-select' ? (
        <section className="setup-screen pregame-screen mode-select-screen">
          <GameMasthead compact />
          <GuestIdentity name={username} />
          <div className="action-grid action-grid-two mode-action-grid">
            <ActionChoice
              label="ONLINE"
              description="Play against another person."
              onClick={() => {
                setStatus({
                  tone: 'neutral',
                  label: 'ONLINE',
                  detail: `Ready to connect as ${username}.`,
                })
                setScreen('online-menu')
              }}
            />
            <ActionChoice
              label="OFFLINE"
              description="Practice against the bot."
              tone="secondary"
              onClick={() => {
                setStatus({
                  tone: 'success',
                  label: 'OFFLINE',
                  detail: 'Practice bot ready.',
                })
                setScreen('offline-setup')
              }}
            />
          </div>
        </section>
      ) : null}

      {screen === 'online-menu' ? (
        <section className="setup-screen pregame-screen">
          <GameMasthead compact />
          <GuestIdentity name={username} />
          <div className="action-grid online-action-grid">
            <ActionChoice
              label="QUICK MATCH"
              description="Find any available opponent."
              onClick={() => void startOnline()}
            />
            <ActionChoice
              label="CREATE GAME"
              description="Make a private match."
              badge="Coming soon"
              tone="secondary"
              disabled
            />
            <ActionChoice
              label="FIND GAME"
              description="Join a private match."
              badge="Coming soon"
              tone="secondary"
              disabled
            />
          </div>
          <OnlineAdminSettings
            user={authUser}
            rounds={rounds}
            turnSeconds={turnSeconds}
            blindMode={blindMode}
            onRoundsChange={setRounds}
            onTurnSecondsChange={setTurnSeconds}
            onBlindModeChange={setBlindMode}
          />
        </section>
      ) : null}

      {screen === 'offline-setup' ? (
        <section className="setup-screen pregame-screen offline-setup-screen">
          <GameMasthead compact />
          <GuestIdentity name={username} />
          <div className="offline-card">
            <p className="practice-kicker">PRACTICE</p>
            <p className="panel-description">
              Learn the board or tune the rules before going online.
            </p>
            <BrushButton className="big-action" onClick={() => void startOffline()}>
              START PRACTICE
            </BrushButton>
            <AdvancedSettings
              rounds={rounds}
              turnSeconds={turnSeconds}
              blindMode={blindMode}
              onRoundsChange={setRounds}
              onTurnSecondsChange={setTurnSeconds}
              onBlindModeChange={setBlindMode}
            />
          </div>
        </section>
      ) : null}

      {screen === 'matchmaking' ? (
        <section className="setup-screen pregame-screen pregame-single-panel">
          <GameMasthead compact />
          <GuestIdentity name={username} />
          <div className="single-panel">
            <p className="brush-subtitle">QUICK MATCH</p>
            <h1>{status.label === 'SEARCHING' ? 'Finding a player' : 'Connecting'}</h1>
            <strong>{status.label === 'SEARCHING' ? searchClock : '•••'}</strong>
          </div>
        </section>
      ) : null}

      {screen === 'ready' ? (
        <section className="setup-screen pregame-screen pregame-single-panel">
          <GameMasthead compact />
          <GuestIdentity name={username} />
          <div className="single-panel">
            <p className="brush-subtitle">QUICK MATCH</p>
            <h1>Opponent found</h1>
            <MatchRulesSummary
              rules={onlineRules ?? DEFAULT_MATCH_RULES}
            />
            <BrushButton disabled={readyLocked} onClick={onReady}>
              {readyLocked ? 'READY...' : 'READY'}
            </BrushButton>
          </div>
        </section>
      ) : null}

      {screen === 'countdown' ? (
        <section className="countdown-screen">
          <span>{countdown}</span>
        </section>
      ) : null}

      {screen === 'battle' && match ? (
        <section className="battle-screen">
          <header className="battle-header">
            <h1>Current Round: {match.currentRound}</h1>
            <p>{statusText}</p>
            {announcement ? (
              <div className="battle-announcement" role="status" aria-live="polite">
                {announcement}
              </div>
            ) : null}
            <div className="timer-track" aria-label={`${turnTimeLeft.toFixed(1)} seconds left`}>
              <span style={{ width: `${Math.max(0, Math.min(100, (turnTimeLeft / match.config.turnSeconds) * 100))}%` }} />
            </div>
          </header>

          <div className="battle-stage">
            <div className="battle-arena">
              <BoardGrid
                title="Player Board"
                subtitle={username.trim() || 'Player'}
                grid={match.playerGrid}
                interactive={
                  match.isMyTurn &&
                  (!match.config.isOnline || !onlineInputPending)
                }
                selectedColor={match.selectedColor}
                destructionEffects={visiblePlayerDestructionEffects}
                onSelect={onCellSelect}
              />
              {showOpponent ? (
                <aside className="opponent-peek" aria-label={`${opponentName}'s revealed board`}>
                  <p>REVEALED</p>
                  <BoardGrid
                    title="Opponent Board"
                    subtitle={opponentName}
                    grid={match.opponentGrid}
                    compact
                    destructionEffects={opponentDestructionEffects}
                  />
                </aside>
              ) : null}
            </div>
            <div className="battle-controls">
              <PowerupTray
                powerups={match.playerPowerups}
                disabled={
                  !match.isMyTurn ||
                  (match.config.isOnline && onlineInputPending)
                }
                onUse={onPowerup}
              />
              <div
                className={`rps-dock ${awaitingMoveChoice ? 'rps-dock-awaiting' : ''}`}
                aria-label="Move loader"
              >
                {pieces.map((piece) => (
                  <button
                    key={piece.label}
                    type="button"
                    disabled={
                      match.config.isOnline && onlineInputPending
                    }
                    onClick={() => onSelectColor(piece.color)}
                    className={`rps-tile ${match.selectedColor === piece.color ? 'rps-tile-selected' : ''}`}
                    style={{ backgroundColor: piece.color }}
                  >
                    <img src={piece.icon} alt="" />
                    <span>{piece.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {screen === 'results' && match?.result ? (
        <section className="results-screen">
          <div className="results-copy">
            <p className="brush-subtitle">GAME OVER</p>
            <h1>{match.result.outcome === 'win' ? 'YOU WIN!' : match.result.outcome === 'loss' ? 'YOU LOSE!' : "IT'S A TIE!"}</h1>
            <p>
              Your Score: {match.result.playerScore}
              <br />
              Opponent Score: {match.result.opponentScore}
            </p>
            <div className="results-actions">
              <BrushButton className="results-action" onClick={onAgain}>
                AGAIN?
              </BrushButton>
            </div>
          </div>
          <div className="final-boards">
            <BoardGrid
              title=""
              subtitle={username.trim() || 'Player'}
              grid={match.playerGrid}
              destructionEffects={playerDestructionEffects}
              scoreCountLabels={playerScoreCountLabels}
            />
            <BoardGrid
              title=""
              subtitle={opponentName}
              grid={match.opponentGrid}
              destructionEffects={opponentDestructionEffects}
              scoreCountLabels={opponentScoreCountLabels}
            />
          </div>
        </section>
      ) : null}

      {screen === 'disconnected' ? (
        <section className="setup-screen pregame-screen pregame-single-panel">
          <GameMasthead compact />
          <div className="single-panel">
            <img src={exitDoorIcon} alt="" className="single-panel-icon" />
            <p className="brush-subtitle">DISCONNECTED</p>
            <h1>The room went dark.</h1>
            <BrushButton onClick={backHome}>HIDDEN</BrushButton>
          </div>
        </section>
      ) : null}

      {screen === 'sync-lost' ? (
        <section className="setup-screen pregame-screen pregame-single-panel">
          <GameMasthead compact />
          <div className="single-panel">
            <img src={exitDoorIcon} alt="" className="single-panel-icon" />
            <p className="brush-subtitle">SYNC LOST</p>
            <h1>This match can no longer be verified.</h1>
            <p>{status.detail}</p>
            <BrushButton onClick={navigateBack}>BACK TO ONLINE</BrushButton>
          </div>
        </section>
      ) : null}
    </main>
  )
}

export default App
