import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import './animations/turn-focus.css'
import { createAdminClient } from './admin/adminClient'
import paperIcon from './assets/icons/battle/move-paper.png'
import rockIcon from './assets/icons/battle/move-rock.png'
import scissorsIcon from './assets/icons/battle/move-scissors.png'
import exitDoorIcon from './assets/icons/exit-door.png'
import { createAuthClient } from './auth/authClient'
import type { AccountMode } from './auth/accountValidation'
import { AccountForm } from './components/AccountForm'
import { AdminPanel } from './components/AdminPanel'
import { BoardGrid } from './components/BoardGrid'
import { HowToPlayModal, HowToPlayTrigger } from './components/HowToPlayModal'
import { MatchHistoryScreen } from './components/MatchHistory'
import { PowerupTray } from './components/PowerupTray'
import { ProfileMenu } from './components/ProfileMenu'
import { RuleChip } from './components/RuleControls'
import { ONLINE_RULE_SECTIONS } from './components/ruleSchema'
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
import { COLOR_BY_SYMBOL } from './game/constants'
import { createMatchHistoryClient } from './history/historyClient'
import {
  clampGameConfig,
  clampOnlineGameConfig,
  DEFAULT_GAME_CONFIG,
  type ClassicSymbol,
  type GameConfig,
} from '@hidden/game-core'
import { useAccountSession } from './hooks/useAccountSession'
import { useDestructionEffects } from './hooks/useDestructionEffects'
import { useLobbyBrowser } from './hooks/useLobbyBrowser'
import { useMatchSession } from './hooks/useMatchSession'
import {
  createGuestName,
  getBackTarget,
  getOpponentName,
  getScoreCountLabels,
  getTurnStatusText,
  resolvePlayerName,
  shouldPromptMoveChoice,
  shouldShowOpponentBoard,
  type Screen,
} from './game/viewModel'

const pieces: ReadonlyArray<{
  symbol: ClassicSymbol
  label: string
  icon: string
}> = [
  { symbol: 'rock', label: 'Rock', icon: rockIcon },
  { symbol: 'paper', label: 'Paper', icon: paperIcon },
  { symbol: 'scissors', label: 'Scissors', icon: scissorsIcon },
]

const accountClient = createAuthClient()
const adminClient = createAdminClient()
const matchHistoryClient = createMatchHistoryClient()

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
  const [howToPlayOpen, setHowToPlayOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminLockActive, setAdminLockActive] = useState(false)
  const [guestUsername] = useState(createGuestName)
  // One config object rather than one state hook per knob: the knob count grows
  // with every rule experiment, the call sites should not.
  const [config, setConfig] = useState<GameConfig>(DEFAULT_GAME_CONFIG)
  const {
    lobbyGames,
    hostedCode,
    hostingStarted,
    isPrivateGame,
    joinCodeInput,
    lobbyError,
    clearLobbyError,
    prepareCreate: prepareLobbyCreate,
    beginHosting,
    beginBrowsing,
    clearForMatchFound: clearLobbyForMatchFound,
    leaveLobby,
    togglePrivateGame,
    setJoinCodeInput,
    handleClientEvent: handleLobbyClientEvent,
  } = useLobbyBrowser()
  const applyConfigPatch = (patch: Partial<GameConfig>) =>
    // Clamping here means the UI cannot produce an invalid config, so the
    // server clamp becomes a defence rather than the only guard.
    setConfig((current) => clampGameConfig({ ...current, ...patch }))
  const [status, setStatus] = useState<UiStatus>({
    tone: 'neutral',
    label: 'GUEST',
    detail: 'Choose how you want to play.',
  })
  const {
    authUser,
    authHydrated,
    authMode,
    authBusy,
    authError,
    prepareAccount,
    submitAccount: submitAccountCredentials,
    logoutAccount,
    invalidateSession,
  } = useAccountSession({
    client: accountClient,
    guestUsername,
    onStatusChange: setStatus,
  })
  const {
    playerDestructionEffects,
    queueDestructionEffect,
    clearDestructionEffects,
  } = useDestructionEffects()

  const screenRef = useRef<Screen>('intro')
  const historyReturnScreenRef = useRef<Screen>('intro')
  const {
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
    ready: onReady,
    playAgain: onAgain,
    selectSymbol: onSelectSymbol,
    selectCell: onCellSelect,
    activatePowerup: onPowerup,
  } = useMatchSession({
    screen,
    screenRef,
    setScreen,
    setStatus,
    clearDestructionEffects,
    queueDestructionEffect,
    lobby: {
      clearLobbyError,
      beginHosting,
      beginBrowsing,
      clearForMatchFound: clearLobbyForMatchFound,
      leaveLobby,
      handleClientEvent: handleLobbyClientEvent,
    },
  })
  const username = resolvePlayerName(authUser?.username, guestUsername)

  useEffect(() => {
    screenRef.current = screen
  }, [screen])

  const openAccount = useCallback((mode: AccountMode) => {
    resetForAccountChange()
    prepareAccount(mode)
    setScreen('account')
  }, [prepareAccount, resetForAccountChange])

  const submitAccount = useCallback(
    async (submittedUsername: string, password: string) => {
      await submitAccountCredentials(submittedUsername, password)
      setScreen('mode-select')
    },
    [submitAccountCredentials],
  )

  const logout = useCallback(async () => {
    if (!await logoutAccount()) return
    setAdminOpen(false)
    resetForAccountChange(true)
    setScreen('intro')
  }, [logoutAccount, resetForAccountChange])

  const backHome = useCallback(() => {
    resetForHome()
    setStatus({
      tone: 'neutral',
      label: authUser ? 'ACCOUNT' : 'GUEST',
      detail: authUser
        ? `Signed in as ${username}.`
        : 'Choose how you want to play.',
    })
    setScreen('intro')
  }, [authUser, resetForHome, username])

  const navigateBack = useCallback(() => {
    const current = screenRef.current

    if (current === 'history') {
      clearAnnouncement()
      setScreen(historyReturnScreenRef.current)
      return
    }

    const isOnlineMatch =
      current === 'disconnected' ||
      current === 'sync-lost' ||
      match?.config.isOnline === true
    const target = getBackTarget(current, isOnlineMatch)

    if (target === 'intro') {
      backHome()
      return
    }

    resetForNavigation(current, isOnlineMatch)
    const nextStatus: UiStatus =
      target === 'online-menu'
        ? { tone: 'neutral', label: 'ONLINE', detail: `Ready to connect as ${username}.` }
        : target === 'offline-setup'
          ? { tone: 'success', label: 'OFFLINE', detail: 'Practice bot ready.' }
          : { tone: 'neutral', label: 'GUEST', detail: `Playing as ${username}.` }

    setStatus(nextStatus)
    setScreen(target)
  }, [backHome, clearAnnouncement, match, resetForNavigation, username])

  const openHistory = useCallback(() => {
    const current = screenRef.current
    if (current === 'history') return
    historyReturnScreenRef.current = current
    clearAnnouncement()
    setScreen('history')
  }, [clearAnnouncement])

  const closeAdmin = useCallback(() => setAdminOpen(false), [])

  const expireAdminSession = useCallback(() => {
    resetForAccountChange()
    invalidateSession('Your session expired. Sign in again to use the admin workspace.')
    setAdminOpen(false)
    setStatus({
      tone: 'error',
      label: 'SESSION EXPIRED',
      detail: 'Sign in again to use the admin workspace.',
    })
    setScreen('account')
  }, [invalidateSession, resetForAccountChange])

  /*
   * One config is shared by every setup screen, so a sub-second turn timer set
   * for offline practice follows the player into hosting. The server floors it
   * at two seconds regardless; showing the floor here keeps the panel from
   * promising a number the match will not honour.
   */
  const onlineConfig = clampOnlineGameConfig(config)
  const opponentName = getOpponentName(users, clientId, match)
  const showOpponent = shouldShowOpponentBoard(match, screen)
  const searchClock = `${Math.floor(searchSeconds / 60).toString().padStart(2, '0')}:${(searchSeconds % 60)
    .toString()
    .padStart(2, '0')}`
  const inlineStatus =
    screen === 'matchmaking' && status.label === 'SEARCHING'
      ? { ...status, detail: `Looking for an opponent · ${searchClock}` }
      : status
  const chromeStatus: UiStatus =
    screen === 'history'
      ? {
          tone: 'neutral',
          label: 'HISTORY',
          detail: `${username}'s completed online matches.`,
        }
      : screen === 'results' && match?.result
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
    screen === 'battle' && match ? getTurnStatusText(match) : status.detail
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

  if (adminLockActive !== accountChangeLocked) {
    setAdminLockActive(accountChangeLocked)
    if (accountChangeLocked && adminOpen) setAdminOpen(false)
  }

  return (
    <main className={`hidden-shell hidden-${screen}`}>
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
                role={authUser.role}
                busy={authBusy}
                disabled={accountChangeLocked || screen === 'account'}
                onOpenAdmin={() => setAdminOpen(true)}
                onOpenHistory={openHistory}
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

      {screen === 'history' ? (
        <MatchHistoryScreen
          client={matchHistoryClient}
          onSignIn={() => {
            invalidateSession()
            openAccount('login')
          }}
        />
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
          <HowToPlayTrigger onClick={() => setHowToPlayOpen(true)} />
          <div className="action-grid online-action-grid">
            <ActionChoice
              label="QUICK MATCH"
              description="Find any available opponent."
              onClick={() => void startOnline(
                username,
                // Quick Match rules are admin-only because they bind a stranger.
                authUser?.role === 'admin' ? config : undefined,
              )}
            />
            <ActionChoice
              label="CREATE GAME"
              description="Host with your own rules."
              tone="secondary"
              onClick={() => {
                prepareLobbyCreate()
                setScreen('lobby-create')
              }}
            />
            <ActionChoice
              label="FIND GAME"
              description="Join someone else's game."
              tone="secondary"
              onClick={() => void findGames(username)}
            />
          </div>
          <OnlineAdminSettings
            user={authUser}
            config={onlineConfig}
            onConfigChange={applyConfigPatch}
            sections={ONLINE_RULE_SECTIONS}
          />
        </section>
      ) : null}

      {screen === 'lobby-create' ? (
        <section className="setup-screen pregame-screen">
          <GameMasthead compact />
          <GuestIdentity name={username} />
          {!hostingStarted ? (
            <div className="lobby-host-setup">
              <p>Set the rules for your game, then host it.</p>
              {/* Ungated, unlike Quick Match: a host owns their own rules. */}
              <AdvancedSettings
                config={onlineConfig}
                onConfigChange={applyConfigPatch}
                sections={ONLINE_RULE_SECTIONS}
              />
              {/* Not a GameConfig rule, but it shares the panel's on/off vocabulary. */}
              <section className="rule-section lobby-room-section">
                <h3 className="rule-section-label">Room</h3>
                <div className="rule-chips">
                  <RuleChip
                    id="isPrivateGame"
                    label="Private (code only)"
                    pressed={isPrivateGame}
                    onToggle={togglePrivateGame}
                  />
                </div>
              </section>
              <BrushButton
                onClick={() => void hostGame(username, config, isPrivateGame)}
              >
                HOST GAME
              </BrushButton>
            </div>
          ) : null}
          {hostedCode ? (
            <div className="lobby-waiting">
              <p>Waiting for a player…</p>
              {isPrivateGame ? (
                <>
                  <p className="lobby-code-label">Share this code</p>
                  <p className="lobby-code">{hostedCode}</p>
                </>
              ) : (
                <p className="lobby-code-label">
                  Your game is listed under Find Game.
                </p>
              )}
              <MatchRulesSummary config={config} />
            </div>
          ) : null}
          <BrushButton tone="red" onClick={leaveLobbyScreen}>
            CANCEL
          </BrushButton>
        </section>
      ) : null}

      {screen === 'lobby-find' ? (
        <section className="setup-screen pregame-screen">
          <GameMasthead compact />
          <GuestIdentity name={username} />
          {lobbyError ? <p className="lobby-error">{lobbyError}</p> : null}
          <div className="lobby-browser">
            <section className="lobby-list-panel">
              <h3 className="rule-section-label" id="lobby-list-label">
                Open games{lobbyGames.length ? ` · ${lobbyGames.length}` : ''}
              </h3>
              {/* Fixed-height scroller: 3 games and 30 games occupy the same box. */}
              <div className="lobby-list" aria-labelledby="lobby-list-label">
                {lobbyGames.length === 0 ? (
                  <p className="lobby-empty">No open games right now.</p>
                ) : (
                  lobbyGames.map((game) => (
                    <button
                      key={game.code}
                      type="button"
                      className="lobby-row"
                      onClick={() => joinLobbyGame(game.code)}
                    >
                      <strong>{game.hostName}</strong>
                      <MatchRulesSummary config={game.config} />
                    </button>
                  ))
                )}
              </div>
            </section>
            <div className="lobby-code-entry">
              <label className="rule-section-label" htmlFor="lobby-join-code">
                Join by code
              </label>
              <div className="lobby-code-fields">
                <input
                  id="lobby-join-code"
                  value={joinCodeInput}
                  maxLength={5}
                  placeholder="ABC12"
                  onChange={(event) => setJoinCodeInput(event.target.value)}
                />
                {/* Compact rather than brush: an inline field action, not navigation. */}
                <button
                  type="button"
                  className="lobby-join"
                  disabled={joinCodeInput.length !== 5}
                  onClick={() => {
                    if (joinCodeInput.length === 5) {
                      joinLobbyGame(joinCodeInput)
                    }
                  }}
                >
                  JOIN
                </button>
              </div>
            </div>
          </div>
          <BrushButton tone="red" onClick={leaveLobbyScreen}>
            BACK
          </BrushButton>
        </section>
      ) : null}

      {screen === 'offline-setup' ? (
        <section className="setup-screen pregame-screen offline-setup-screen">
          <GameMasthead compact />
          <GuestIdentity name={username} />
          <HowToPlayTrigger onClick={() => setHowToPlayOpen(true)} />
          <div className="offline-card">
            <p className="practice-kicker">PRACTICE</p>
            <p className="panel-description">
              Learn the board or tune the rules before going online.
            </p>
            <BrushButton
              className="big-action"
              onClick={() => void startOffline(config)}
            >
              START PRACTICE
            </BrushButton>
            <AdvancedSettings
              config={config}
              onConfigChange={applyConfigPatch}
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
              config={onlineRules ?? DEFAULT_GAME_CONFIG}
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
            {/* Always mounted. The strip is a fixed slot in the header, so a
              * message arriving or expiring never resizes the header and shoves
              * the board underneath it. */}
            <div className="battle-announcement" role="status" aria-live="polite">
              {announcement}
            </div>
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
                selectedSymbol={match.selectedSymbol}
                destructionEffects={playerDestructionEffects}
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
                  />
                </aside>
              ) : null}
            </div>
            <div className="battle-controls">
              {/* Hidden entirely when the variant has no power-ups, so a
                  no-power-up test does not show an unusable tray. */}
              {match.config.powerupsEnabled ? (
                <PowerupTray
                  powerups={match.playerPowerups}
                  disabled={
                    !match.isMyTurn ||
                    (match.config.isOnline && onlineInputPending)
                  }
                  onUse={onPowerup}
                />
              ) : null}
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
                    onClick={() => onSelectSymbol(piece.symbol)}
                    className={`rps-tile ${match.selectedSymbol === piece.symbol ? 'rps-tile-selected' : ''}`}
                    style={{ backgroundColor: COLOR_BY_SYMBOL[piece.symbol] }}
                    // The icon reads on its own, so the caption is gone. The
                    // label moves onto the button or it has no accessible name
                    // at all — the image is decorative.
                    aria-label={piece.label}
                  >
                    <img src={piece.icon} alt="" />
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
            <p className="results-score">
              Your Score: <b>{match.result.playerScore}</b>
              <br />
              Opponent Score: <b>{match.result.opponentScore}</b>
            </p>
            <div className="results-actions">
              <BrushButton className="results-action" onClick={onAgain}>
                AGAIN?
              </BrushButton>
            </div>
          </div>
          {/* The final boards are a score audit. Desecration constrains the next
            * move, and there is no next move, so it would only be noise here. */}
          <div className="final-boards">
            <BoardGrid
              title=""
              subtitle={username.trim() || 'Player'}
              grid={match.playerGrid}
              showDesecration={false}
              destructionEffects={playerDestructionEffects}
              scoreCountLabels={playerScoreCountLabels}
            />
            <BoardGrid
              title=""
              subtitle={opponentName}
              grid={match.opponentGrid}
              showDesecration={false}
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

      <HowToPlayModal
        open={howToPlayOpen}
        onClose={() => setHowToPlayOpen(false)}
      />
      <AdminPanel
        open={adminOpen}
        client={adminClient}
        onClose={closeAdmin}
        onSessionExpired={expireAdminSession}
      />
    </main>
  )
}

export default App
