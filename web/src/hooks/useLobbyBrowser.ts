import { useCallback, useState } from 'react'
import type { ClientEvent } from '../game/networkClient'
import type {
  LobbyErrorReason,
  PublicGameSummary,
} from '../game/protocol'

const LOBBY_ERROR_MESSAGES: Record<LobbyErrorReason, string> = {
  'not-found': 'No game with that code. It may have started or been cancelled.',
  'already-hosting': 'You are already hosting a game.',
  'already-in-match': 'You are already in a match.',
  'own-game': 'You cannot join your own game.',
}

export interface LobbyBrowser {
  lobbyGames: PublicGameSummary[]
  hostedCode: string | null
  hostingStarted: boolean
  isPrivateGame: boolean
  joinCodeInput: string
  lobbyError: string | null
  clearLobbyError: () => void
  prepareCreate: () => void
  beginHosting: () => void
  beginBrowsing: () => void
  clearForMatchFound: () => void
  leaveLobby: () => void
  togglePrivateGame: () => void
  setJoinCodeInput: (value: string) => void
  handleClientEvent: (event: ClientEvent) => boolean
}

export function useLobbyBrowser(): LobbyBrowser {
  const [lobbyGames, setLobbyGames] = useState<PublicGameSummary[]>([])
  const [hostedCode, setHostedCode] = useState<string | null>(null)
  const [hostingStarted, setHostingStarted] = useState(false)
  const [isPrivateGame, setIsPrivateGame] = useState(false)
  const [joinCodeInput, setJoinCode] = useState('')
  const [lobbyError, setLobbyError] = useState<string | null>(null)

  const clearLobbyError = useCallback(() => setLobbyError(null), [])

  const prepareCreate = useCallback(() => {
    setHostedCode(null)
    setHostingStarted(false)
    setLobbyError(null)
  }, [])

  const beginHosting = useCallback(() => {
    setHostedCode(null)
    setHostingStarted(true)
    setLobbyError(null)
  }, [])

  const beginBrowsing = useCallback(() => {
    setLobbyGames([])
    setLobbyError(null)
  }, [])

  const clearForMatchFound = useCallback(() => {
    setLobbyError(null)
    setHostedCode(null)
  }, [])

  const leaveLobby = useCallback(() => {
    setHostedCode(null)
    setHostingStarted(false)
    setLobbyGames([])
    setLobbyError(null)
  }, [])

  const togglePrivateGame = useCallback(() => {
    setIsPrivateGame((current) => !current)
  }, [])

  const setJoinCodeInput = useCallback((value: string) => {
    setJoinCode(value.toUpperCase())
  }, [])

  const handleClientEvent = useCallback((event: ClientEvent) => {
    if (event.type === 'lobby-created') {
      setHostedCode(event.code)
      return true
    }
    if (event.type === 'lobby-list') {
      setLobbyGames(event.games)
      return true
    }
    if (event.type === 'lobby-error') {
      setLobbyError(LOBBY_ERROR_MESSAGES[event.reason])
      return true
    }
    return false
  }, [])

  return {
    lobbyGames,
    hostedCode,
    hostingStarted,
    isPrivateGame,
    joinCodeInput,
    lobbyError,
    clearLobbyError,
    prepareCreate,
    beginHosting,
    beginBrowsing,
    clearForMatchFound,
    leaveLobby,
    togglePrivateGame,
    setJoinCodeInput,
    handleClientEvent,
  }
}
