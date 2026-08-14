import { DEFAULT_GAME_CONFIG } from '@hidden/game-core'
import { encode } from '@msgpack/msgpack'
import { describe, expect, it } from 'vitest'
import {
  decodeClientPacket,
  PacketType,
  ProtocolError,
} from './protocol'

describe('decodeClientPacket', () => {
  it('pins every supported packet id and appends authoritative gameplay without renumbering', () => {
    expect(PacketType.ID_ASSIGN).toBe(2)
    expect(PacketType.ROOM_JOIN).toBe(5)
    expect(PacketType.ROOM_LEAVE).toBe(6)
    expect(PacketType.SERVER_RESPONSE).toBe(8)
    expect(PacketType.USER_INFO).toBe(9)
    expect(PacketType.GAME_MOVE).toBe(10)
    expect(PacketType.IMMUNE_UPDATE).toBe(11)
    expect(PacketType.READY_STATE).toBe(12)
    expect(PacketType.MATCHMAKING_REQUEST).toBe(13)
    expect(PacketType.MATCH_FOUND).toBe(14)
    expect(PacketType.GAME_START).toBe(15)
    expect(PacketType.OPPONENT_DISCONNECTED).toBe(17)
    expect(PacketType.GAME_MOVES).toBe(18)
    expect(PacketType.GAME_COMMAND).toBe(19)
    expect(PacketType.GAME_UPDATE).toBe(20)
  })

  it('normalizes a valid username packet without trusting its sender id', () => {
    expect(
      decodeClientPacket(encode([999, PacketType.USER_INFO, '  EchoStrike  '])),
    ).toEqual({
      type: PacketType.USER_INFO,
      username: 'EchoStrike',
    })
  })

  it.each(['', '   ', 'x'.repeat(25)])(
    'rejects an invalid username',
    (username) => {
      expect(() =>
        decodeClientPacket(encode([1, PacketType.USER_INFO, username])),
      ).toThrow(ProtocolError)
    },
  )

  it('accepts a valid game move', () => {
    expect(
      decodeClientPacket(encode([456, PacketType.GAME_MOVE, 8, 'green'])),
    ).toEqual({
      type: PacketType.GAME_MOVE,
      index: 8,
      color: 'green',
    })
  })

  it.each([
    [9, 'green'],
    [-1, 'green'],
    [0, 'purple'],
    [0.5, 'red'],
  ])('rejects an invalid game move', (index, color) => {
    expect(() =>
      decodeClientPacket(encode([1, PacketType.GAME_MOVE, index, color])),
    ).toThrow(ProtocolError)
  })

  it('accepts at most two validated extra-turn moves', () => {
    expect(
      decodeClientPacket(
        encode([1, PacketType.GAME_MOVES, [0, 8], ['red', 'blue']]),
      ),
    ).toEqual({
      type: PacketType.GAME_MOVES,
      moves: [
        { index: 0, color: 'red' },
        { index: 8, color: 'blue' },
      ],
    })

    expect(() =>
      decodeClientPacket(
        encode([1, PacketType.GAME_MOVES, [0, 1, 2], ['red', 'blue', 'green']]),
      ),
    ).toThrow(ProtocolError)
  })

  it('decodes a keyed game-command envelope, ignores its sender, and normalizes command keys', () => {
    expect(
      decodeClientPacket(
        encode([
          999,
          PacketType.GAME_COMMAND,
          {
            matchId: 'run-uuid',
            commandId: 7,
            expectedRevision: 3,
            ignoredOuterKey: true,
            command: {
              type: 'place',
              locationId: 4,
              symbol: 'rock',
              ignoredCommandKey: 'never canonical',
            },
          },
        ]),
      ),
    ).toEqual({
      type: PacketType.GAME_COMMAND,
      envelope: {
        matchId: 'run-uuid',
        commandId: 7,
        expectedRevision: 3,
        command: { type: 'place', locationId: 4, symbol: 'rock' },
      },
    })
  })

  it('decodes an early reveal close', () => {
    // The player may close the snapshot before the authority's window expires,
    // so this is a legitimate client command. `timeout` stays server-only.
    expect(
      decodeClientPacket(
        encode([
          999,
          PacketType.GAME_COMMAND,
          {
            matchId: 'run-uuid',
            commandId: 9,
            expectedRevision: 4,
            command: { type: 'end-reveal', ignoredCommandKey: 'never canonical' },
          },
        ]),
      ),
    ).toEqual({
      type: PacketType.GAME_COMMAND,
      envelope: {
        matchId: 'run-uuid',
        commandId: 9,
        expectedRevision: 4,
        command: { type: 'end-reveal' },
      },
    })
  })

  it.each([
    { type: 'timeout' },
    { type: 'place', locationId: 0, symbol: 'lizard' },
    { type: 'activate-powerup', powerup: 'teleport' },
    { type: 'select-shield-target', locationId: '0' },
    { type: 'unknown-command' },
    null,
  ])('keeps a well-formed envelope with invalid command content routable', (command) => {
    expect(
      decodeClientPacket(
        encode([
          999,
          PacketType.GAME_COMMAND,
          {
            matchId: 'run-uuid',
            commandId: 8,
            expectedRevision: 3,
            command,
          },
        ]),
      ),
    ).toEqual({
      type: PacketType.GAME_COMMAND,
      envelope: {
        matchId: 'run-uuid',
        commandId: 8,
        expectedRevision: 3,
        command: null,
      },
    })
  })

  it.each([
    undefined,
    null,
    [],
    { matchId: '', commandId: 1, expectedRevision: 0, command: {} },
    { matchId: 'run', commandId: -1, expectedRevision: 0, command: {} },
    { matchId: 'run', commandId: 0.5, expectedRevision: 0, command: {} },
    { matchId: 'run', commandId: Number.MAX_SAFE_INTEGER + 1, expectedRevision: 0, command: {} },
    { matchId: 'run', commandId: 1, expectedRevision: -1, command: {} },
  ])('policy-rejects a structurally malformed game-command envelope', (envelope) => {
    expect(() =>
      decodeClientPacket(encode([999, PacketType.GAME_COMMAND, envelope])),
    ).toThrow(ProtocolError)
  })

  it('decodes optional matchmaking rules without trusting the sender id', () => {
    expect(
      decodeClientPacket(
        encode([
          999,
          PacketType.MATCHMAKING_REQUEST,
          true,
          { rounds: 8, turnSeconds: 15, blindMode: false },
        ]),
      ),
    ).toEqual({
      type: PacketType.MATCHMAKING_REQUEST,
      searching: true,
      proposedConfig: { ...DEFAULT_GAME_CONFIG, rounds: 8, turnSeconds: 15, blindMode: false },
    })

    // Config decoding is deliberately tolerant: a malformed field falls back
    // to its default rather than discarding the whole proposal, so an older or
    // buggy client degrades to the default game instead of failing to queue.
    expect(
      decodeClientPacket(
        encode([
          999,
          PacketType.MATCHMAKING_REQUEST,
          true,
          { rounds: 8, turnSeconds: 'bad', blindMode: false },
        ]),
      ),
    ).toEqual({
      type: PacketType.MATCHMAKING_REQUEST,
      searching: true,
      proposedConfig: {
        ...DEFAULT_GAME_CONFIG,
        rounds: 8,
        turnSeconds: DEFAULT_GAME_CONFIG.turnSeconds,
        blindMode: false,
      },
    })

    // A non-object proposal is still rejected outright.
    expect(
      decodeClientPacket(
        encode([999, PacketType.MATCHMAKING_REQUEST, true, 'garbage']),
      ),
    ).toEqual({
      type: PacketType.MATCHMAKING_REQUEST,
      searching: true,
    })
  })

  it('rejects unsupported and malformed packets', () => {
    expect(() => decodeClientPacket(encode({ type: 'move' }))).toThrow(
      ProtocolError,
    )
    expect(() => decodeClientPacket(encode([1, 999, true]))).toThrow(
      ProtocolError,
    )
  })
})
