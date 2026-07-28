import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { BoardGrid } from './components/BoardGrid'
import { PowerupTray } from './components/PowerupTray'
import { COLOR_BLUE, COLOR_GREEN, COLOR_RED } from './game/constants'
import {
  activatePowerup,
  applyLocalMove,
  applyRemoteImmuneStatus,
  applyRemoteMove,
  applyRemoteMoves,
  applyShieldSelection,
  createInitialState,
  forceTimeoutAction,
  pickAiMove,
  selectColor,
  startMatch,
} from './game/engine'
import { NetworkClient, resolveWebSocketUrl, type ClientEvent } from './game/networkClient'
import { LOBBY_ROOM_ID, type UserEntry } from './game/protocol'
import type { EngineResult, GameState, MatchConfig, PaintColor, PowerupKey } from './game/types'
import {
  getOpponentName,
  getScreenLabel,
  normalizeUsername,
  shouldShowOpponentBoard,
  type Screen,
} from './game/viewModel'

const ASSET = '/assets'

const pieces = [
  { color: COLOR_GREEN as PaintColor, label: 'Rock', icon: `${ASSET}/rock.png` },
  { color: COLOR_BLUE as PaintColor, label: 'Paper', icon: `${ASSET}/paper.png` },
  { color: COLOR_RED as PaintColor, label: 'Scissors', icon: `${ASSET}/scissors.png` },
]

const usernames = [
  'CodeJunkie',
  'ByteMaster',
  'ScriptLord',
  'DataMiner',
  'NetSurfer',
  'LogicBolt',
  'ThreadWeaver',
  'BinaryBard',
  'AlgorithmGuy',
  'SyntaxHero',
  'ApexPredator',
  'BlazeRunner',
  'CipherBlade',
  'DuskFang',
  'EchoStrike',
  'FrostNova',
  'GhostHunter',
  'HavocAgent',
  'InfernoZero',
  'JoltShock',
]

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
const randomName = () => usernames[Math.floor(Math.random() * usernames.length)] ?? 'HiddenPlayer'
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

interface AdvancedSettingsProps {
  rounds: number
  turnSeconds: number
  blindMode: boolean
  onRoundsChange: (rounds: number) => void
  onTurnSecondsChange: (turnSeconds: number) => void
  onBlindModeChange: (blindMode: boolean) => void
}

function AdvancedSettings({
  rounds,
  turnSeconds,
  blindMode,
  onRoundsChange,
  onTurnSecondsChange,
  onBlindModeChange,
}: AdvancedSettingsProps) {
  return (
    <details className="advanced-panel">
      <summary>Advanced</summary>
      <div className="advanced-grid">
        <label>
          <span>Rounds</span>
          <input
            type="number"
            min={1}
            max={20}
            value={rounds}
            onChange={(event) => onRoundsChange(Math.max(1, Number(event.target.value) || 1))}
          />
        </label>
        <label>
          <span>Timer</span>
          <input
            type="number"
            min={2}
            max={60}
            value={turnSeconds}
            onChange={(event) => onTurnSecondsChange(Math.max(2, Number(event.target.value) || 2))}
          />
        </label>
        <div className="toggle-row">
          <span>Blind</span>
          <button
            type="button"
            className={`unity-toggle ${blindMode ? 'unity-toggle-on' : ''}`}
            aria-pressed={blindMode}
            onClick={() => onBlindModeChange(!blindMode)}
          >
            <span />
          </button>
        </div>
      </div>
    </details>
  )
}

interface NamePlateProps {
  username: string
  confirmed: boolean
  onUsernameChange: (value: string) => void
  onRandomize: () => void
  onConfirm: () => void
}

function NamePlate({ username, confirmed, onUsernameChange, onRandomize, onConfirm }: NamePlateProps) {
  return (
    <form
      className="name-stack"
      onSubmit={(event) => {
        event.preventDefault()
        onConfirm()
      }}
    >
      <p className="brush-subtitle">USERNAME: {normalizeUsername(username) || '???'}</p>
      <div className="name-row">
        <input
          value={username}
          onChange={(event) => onUsernameChange(event.target.value)}
          aria-label="Username"
          autoComplete="off"
        />
        <button type="button" className="dice-button" aria-label="Randomize username" onClick={onRandomize}>
          <img src={`${ASSET}/dice.png`} alt="" />
        </button>
      </div>
      <BrushButton className="confirm-button" tone={confirmed ? 'white' : 'yellow'} type="submit">
        {confirmed ? 'NAME LOCKED' : 'CONFIRM NAME'}
      </BrushButton>
    </form>
  )
}

function App() {
  const [screen, setScreen] = useState<Screen>('intro')
  const [username, setUsername] = useState(() => localStorage.getItem('hidden.username') ?? randomName())
  const [rounds, setRounds] = useState(6)
  const [turnSeconds, setTurnSeconds] = useState(10)
  const [blindMode, setBlindMode] = useState(true)
  const [match, setMatch] = useState<GameState | null>(null)
  const [status, setStatus] = useState('Hidden ready.')
  const [announcement, setAnnouncement] = useState('Choose online or offline.')
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<UserEntry[]>([])
  const [roomId, setRoomId] = useState<string | null>(null)
  const [readyLocked, setReadyLocked] = useState(false)
  const [countdown, setCountdown] = useState('3')
  const [searchSeconds, setSearchSeconds] = useState(0)
  const [turnTimeLeft, setTurnTimeLeft] = useState(0)
  const [onlineNameConfirmed, setOnlineNameConfirmed] = useState(false)
  const [clientId, setClientId] = useState<number | null>(null)

  const clientRef = useRef<NetworkClient | null>(null)
  const matchRef = useRef<GameState | null>(null)
  const screenRef = useRef<Screen>('intro')
  const manualCloseRef = useRef(false)
  const settingsRef = useRef({ rounds, turnSeconds, blindMode })

  useEffect(() => {
    matchRef.current = match
  }, [match])

  useEffect(() => {
    screenRef.current = screen
  }, [screen])

  useEffect(() => {
    settingsRef.current = { rounds, turnSeconds, blindMode }
  }, [rounds, turnSeconds, blindMode])

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
    const messages = result.events.filter((event) => event.type === 'announcement').map((event) => event.message)
    if (messages.length > 0) setAnnouncement(messages.join(' / '))

    for (const event of result.events) {
      if (event.type === 'send-move') clientRef.current?.sendMove(event.index, event.color)
      if (event.type === 'send-moves') clientRef.current?.sendMoves(event.moves)
      if (event.type === 'send-immune') clientRef.current?.sendImmune(event.indices)
      if (event.type === 'game-over') setScreen('results')
    }
  }, [])

  const beginCountdown = useCallback(
    async (config: MatchConfig, isMyTurn: boolean) => {
      const base = createInitialState(config)
      matchRef.current = base
      setMatch(base)
      setTurnTimeLeft(config.turnSeconds)
      setScreen('countdown')

      for (const value of ['3', '2', '1', 'GO!']) {
        setCountdown(value)
        await sleep(value === 'GO!' ? 520 : 700)
      }

      const started = startMatch(base, isMyTurn)
      applyEngineResult(started)
      setTurnTimeLeft(config.turnSeconds)
      setScreen('battle')
    },
    [applyEngineResult],
  )

  const onClientEvent = useCallback(
    (event: ClientEvent) => {
      if (event.type === 'open') {
        setStatus('Socket open. Syncing profile...')
        setError(null)
        return
      }

      if (event.type === 'close') {
        if (manualCloseRef.current || screenRef.current === 'intro') {
          manualCloseRef.current = false
          return
        }
        setError(event.reason)
        setStatus(event.reason)
        setScreen('disconnected')
        return
      }

      if (event.type === 'error') {
        setError(event.message)
        setStatus(event.message)
        return
      }

      if (event.type === 'assigned-id') {
        setClientId(event.clientId)
        setStatus(`Connected as client #${event.clientId}.`)
        return
      }

      if (event.type === 'users') {
        setUsers(event.users)
        return
      }

      if (event.type === 'match-found') {
        setRoomId(event.roomId)
        setReadyLocked(false)
        setStatus(`Room ${event.roomId} locked.`)
        setAnnouncement('Player found. Ready up.')
        setScreen('ready')
        return
      }

      if (event.type === 'game-start') {
        const settings = settingsRef.current
        void beginCountdown(makeConfig(settings.rounds, settings.turnSeconds, settings.blindMode, true, false), event.isMyTurn)
        return
      }

      if (!matchRef.current) return

      if (event.type === 'hidden-move' && event.senderId !== clientRef.current?.clientId) {
        applyEngineResult(applyRemoteMove(matchRef.current, event.index, event.color))
      }

      if (event.type === 'hidden-moves' && event.senderId !== clientRef.current?.clientId) {
        applyEngineResult(applyRemoteMoves(matchRef.current, event.moves))
      }

      if (event.type === 'immune' && event.senderId !== clientRef.current?.clientId) {
        applyEngineResult(applyRemoteImmuneStatus(matchRef.current, event.indices))
      }

      if (event.type === 'opponent-disconnected') {
        setError('Opponent disconnected.')
        setStatus('Opponent disconnected.')
        setScreen('disconnected')
      }
    },
    [applyEngineResult, beginCountdown],
  )

  const onTimeout = useCallback(() => {
    if (matchRef.current) applyEngineResult(forceTimeoutAction(matchRef.current))
  }, [applyEngineResult])

  const onAiTurn = useCallback(() => {
    if (!matchRef.current) return
    const move = pickAiMove(matchRef.current)
    if (move) applyEngineResult(applyRemoteMove(matchRef.current, move.index, move.color))
  }, [applyEngineResult])

  useEffect(() => {
    if (screen !== 'battle' || !match || !match.isMyTurn || match.phase !== 'battle') return
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
    manualCloseRef.current = true
    try {
      clientRef.current?.cancelMatchmaking()
    } catch {
      // The socket may already be closed.
    }
    clientRef.current?.close('Returning to Hidden')
    clientRef.current = null
  }, [])

  const backHome = useCallback(() => {
    closeClient()
    setUsers([])
    setRoomId(null)
    setReadyLocked(false)
    setMatch(null)
    matchRef.current = null
    setCountdown('3')
    setTurnTimeLeft(0)
    setSearchSeconds(0)
    setError(null)
    setOnlineNameConfirmed(false)
    setClientId(null)
    setStatus('Hidden ready.')
    setAnnouncement('Choose online or offline.')
    setScreen('intro')
  }, [closeClient])

  const updateUsername = (value: string) => {
    setUsername(value)
    setOnlineNameConfirmed(false)
  }

  const randomizeUsername = () => updateUsername(randomName())

  const confirmOnlineName = () => {
    const trimmed = normalizeUsername(username)
    if (!trimmed) {
      setError('Please enter a username.')
      return
    }
    localStorage.setItem('hidden.username', trimmed)
    setUsername(trimmed)
    setError(null)
    setOnlineNameConfirmed(true)
    setStatus(`Username locked: ${trimmed}`)
    setAnnouncement('Quick match unlocked.')
  }

  const startOffline = async () => {
    const trimmed = normalizeUsername(username)
    if (!trimmed) {
      setError('Pick a username first.')
      return
    }
    localStorage.setItem('hidden.username', trimmed)
    setUsername(trimmed)
    setError(null)
    setStatus('Practice room open.')
    setAnnouncement('Battle starting.')
    await beginCountdown(makeConfig(rounds, turnSeconds, blindMode, false, true), true)
  }

  const startOnline = async () => {
    const trimmed = normalizeUsername(username)
    if (!trimmed) {
      setError('Pick a username first.')
      return
    }
    localStorage.setItem('hidden.username', trimmed)
    setUsername(trimmed)
    setOnlineNameConfirmed(true)
    setUsers([])
    setRoomId(null)
    setReadyLocked(false)
    setSearchSeconds(0)
    setError(null)
    setStatus('Dialing the server...')
    setAnnouncement('Searching for an opponent.')
    setScreen('matchmaking')

    const client = new NetworkClient()
    client.subscribe((event) => onClientEvent(event))
    clientRef.current = client

    try {
      await client.connect(wsUrl())
      const named = await client.sendUserName(trimmed)
      if (!named) throw new Error('Username rejected.')
      const joined = await client.joinRoom(LOBBY_ROOM_ID)
      if (!joined) throw new Error('Could not join the lobby.')
      client.startMatchmaking()
      setStatus('Searching for an opponent...')
    } catch (cause) {
      closeClient()
      setError(cause instanceof Error ? cause.message : 'Connection failed.')
      setStatus('Connection failed.')
      setScreen('online-name')
    }
  }

  const onReady = () => {
    setReadyLocked(true)
    setStatus('Ready and waiting...')
    setAnnouncement('Ready and waiting...')
    clientRef.current?.sendReady(true)
  }

  const onSelectColor = (color: PaintColor) => {
    if (!matchRef.current) return
    const next = selectColor(matchRef.current, color)
    matchRef.current = next
    setMatch(next)
  }

  const onCellSelect = (index: number) => {
    if (!matchRef.current) return
    if (matchRef.current.shieldSelectionMode) {
      applyEngineResult(applyShieldSelection(matchRef.current, index))
      return
    }
    if (!matchRef.current.selectedColor) {
      setAnnouncement('Pick rock, paper, or scissors first.')
      return
    }
    applyEngineResult(applyLocalMove(matchRef.current, index))
  }

  const onPowerup = (powerup: PowerupKey) => {
    if (matchRef.current) applyEngineResult(activatePowerup(matchRef.current, powerup))
  }

  const opponentName = getOpponentName(users, clientId, match)
  const showOpponent = shouldShowOpponentBoard(match, screen)
  const routeLabel = getScreenLabel(screen)
  const statusText =
    screen === 'battle' && match
      ? match.isMyTurn
        ? match.shieldSelectionMode
          ? 'Choose a tile to shield.'
          : 'Your Turn'
        : `Waiting for ${opponentName}`
      : status

  return (
    <main className={`unity-shell unity-${screen}`}>
      <div className="paint-splatter paint-splatter-blue" />
      <div className="paint-splatter paint-splatter-red" />
      <div className="paint-splatter paint-splatter-purple" />

      {screen !== 'intro' ? (
        <button type="button" className="back-button" onClick={backHome} aria-label="Back to Hidden">
          <img src={`${ASSET}/cancel.png`} alt="" />
        </button>
      ) : null}

      <aside className="status-banner">
        <span>{routeLabel}</span>
        <strong>{statusText}</strong>
        {announcement ? <em>{announcement}</em> : null}
      </aside>

      {error ? <div className="error-banner">{error}</div> : null}

      {screen === 'intro' ? (
        <section className="welcome-screen">
          <h1 className="game-title">HIDDEN</h1>
          <div className="welcome-actions">
            <BrushButton onClick={() => setScreen('online-name')}>ONLINE</BrushButton>
            <BrushButton onClick={() => setScreen('offline-setup')}>OFFLINE</BrushButton>
          </div>
        </section>
      ) : null}

      {screen === 'online-name' ? (
        <section className="setup-screen">
          <h1 className="game-title">HIDDEN</h1>
          <NamePlate
            username={username}
            confirmed={onlineNameConfirmed}
            onUsernameChange={updateUsername}
            onRandomize={randomizeUsername}
            onConfirm={confirmOnlineName}
          />
          {onlineNameConfirmed ? (
            <BrushButton className="big-action" onClick={() => void startOnline()}>
              QUICK MATCH
            </BrushButton>
          ) : null}
        </section>
      ) : null}

      {screen === 'offline-setup' ? (
        <section className="setup-screen offline-setup-screen">
          <h1 className="game-title">HIDDEN</h1>
          <NamePlate
            username={username}
            confirmed
            onUsernameChange={updateUsername}
            onRandomize={randomizeUsername}
            onConfirm={() => {
              const trimmed = normalizeUsername(username)
              if (trimmed) {
                localStorage.setItem('hidden.username', trimmed)
                setUsername(trimmed)
              }
            }}
          />
          <div className="offline-card">
            <p>OFFLINE</p>
            <h2>Hidden</h2>
            <AdvancedSettings
              rounds={rounds}
              turnSeconds={turnSeconds}
              blindMode={blindMode}
              onRoundsChange={setRounds}
              onTurnSecondsChange={setTurnSeconds}
              onBlindModeChange={setBlindMode}
            />
            <BrushButton className="big-action" onClick={() => void startOffline()}>
              START PRACTICE
            </BrushButton>
          </div>
        </section>
      ) : null}

      {screen === 'matchmaking' ? (
        <section className="single-panel">
          <p className="brush-subtitle">MATCHMAKING</p>
          <h1>Searching...</h1>
          <strong>
            {Math.floor(searchSeconds / 60).toString().padStart(2, '0')}:
            {(searchSeconds % 60).toString().padStart(2, '0')}
          </strong>
        </section>
      ) : null}

      {screen === 'ready' ? (
        <section className="single-panel">
          <p className="brush-subtitle">ROOM</p>
          <h1>{roomId}</h1>
          <BrushButton disabled={readyLocked} onClick={onReady}>
            {readyLocked ? 'READY...' : 'READY'}
          </BrushButton>
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
            <div className="timer-track" aria-label={`${turnTimeLeft.toFixed(1)} seconds left`}>
              <span style={{ width: `${Math.max(0, Math.min(100, (turnTimeLeft / match.config.turnSeconds) * 100))}%` }} />
            </div>
          </header>

          <div className={`battle-stage ${showOpponent ? 'battle-stage-split' : 'battle-stage-centered'}`}>
            <PowerupTray powerups={match.playerPowerups} disabled={!match.isMyTurn} onUse={onPowerup} />
            <div className="boards-wrap">
              <BoardGrid
                title="Player Board"
                subtitle={username.trim() || 'Player'}
                grid={match.playerGrid}
                interactive={match.isMyTurn}
                selectedColor={match.selectedColor}
                onSelect={onCellSelect}
              />
              {showOpponent ? (
                <BoardGrid title="Opponent Board" subtitle={opponentName} grid={match.opponentGrid} hidden={!showOpponent} />
              ) : null}
            </div>
          </div>

          <div className="rps-dock" aria-label="Move loader">
            {pieces.map((piece) => (
              <button
                key={piece.label}
                type="button"
                onClick={() => onSelectColor(piece.color)}
                className={`rps-tile ${match.selectedColor === piece.color ? 'rps-tile-selected' : ''}`}
                style={{ backgroundColor: piece.color }}
              >
                <img src={piece.icon} alt="" />
                <span>{piece.label}</span>
              </button>
            ))}
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
            <BrushButton onClick={() => void beginCountdown(makeConfig(rounds, turnSeconds, blindMode, match.config.isOnline, match.config.hasAI), true)}>
              AGAIN?
            </BrushButton>
            <BrushButton tone="white" onClick={backHome}>
              HIDDEN
            </BrushButton>
          </div>
          <div className="final-boards">
            <BoardGrid title="Final Board" subtitle={username.trim() || 'Player'} grid={match.playerGrid} />
            <BoardGrid title="Final Board" subtitle={opponentName} grid={match.opponentGrid} />
          </div>
        </section>
      ) : null}

      {screen === 'disconnected' ? (
        <section className="single-panel">
          <img src={`${ASSET}/exit-door.png`} alt="" className="single-panel-icon" />
          <p className="brush-subtitle">DISCONNECTED</p>
          <h1>The room went dark.</h1>
          <BrushButton onClick={backHome}>HIDDEN</BrushButton>
        </section>
      ) : null}
    </main>
  )
}

export default App
