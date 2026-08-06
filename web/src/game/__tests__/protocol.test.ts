import { DEFAULT_GAME_CONFIG } from '@hidden/game-core'
import { COLOR_GREEN, COLOR_RED } from '../constants'
import { decode, encode } from '@msgpack/msgpack'
import {
  decodePacket,
  encodeGameCommandPacket,
  encodeMatchmakingPacket,
  LOBBY_ROOM_ID,
  PacketType,
} from '../protocol'

describe('protocol', () => {
  it('uses the only server-supported direct room id', () => {
    expect(LOBBY_ROOM_ID).toBe('lobby')
  })

  it('decodes an opponent ready-state relay', () => {
    expect(decodePacket(encode([4, PacketType.READY_STATE, true]))).toEqual({
      type: PacketType.READY_STATE,
      senderId: 4,
      ready: true,
    })
  })

  it('keeps every packet id stable and appends authoritative gameplay', () => {
    expect(PacketType.CHAT).toBe(0)
    expect(PacketType.POSITION).toBe(1)
    expect(PacketType.ID_ASSIGN).toBe(2)
    expect(PacketType.TIME_SYNC).toBe(3)
    expect(PacketType.ROOM_CREATE).toBe(4)
    expect(PacketType.ROOM_JOIN).toBe(5)
    expect(PacketType.ROOM_LEAVE).toBe(6)
    expect(PacketType.ROOM_DESTROY).toBe(7)
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

  it('keeps decoding the legacy first-player position when game start appends a descriptor', () => {
    expect(
      decodePacket(
        encode([
          0,
          PacketType.GAME_START,
          7,
          {
            matchId: '78bd46ff-cc07-46df-949a-eea9c543fdac',
            engine: { id: 'classic', revision: 1 },
            config: DEFAULT_GAME_CONFIG,
            seed: 42,
            firstSeat: 0,
            revision: 0,
            turnTimeRemainingMs: 10_000,
          },
        ]),
      ),
    ).toEqual({
      type: PacketType.GAME_START,
      firstPlayerId: 7,
      descriptor: {
        matchId: '78bd46ff-cc07-46df-949a-eea9c543fdac',
        engine: { id: 'classic', revision: 1 },
        config: DEFAULT_GAME_CONFIG,
        seed: 42,
        firstSeat: 0,
        revision: 0,
        turnTimeRemainingMs: 10_000,
      },
    })
  })

  it('carries a non-default board size through a game start', () => {
    const packet = decodePacket(
      encode([
        0,
        PacketType.GAME_START,
        7,
        {
          matchId: 'match-5x5',
          engine: { id: 'classic', revision: 1 },
          config: { ...DEFAULT_GAME_CONFIG, boardSize: 5, streak: 4 },
          seed: 42,
          firstSeat: 0,
          revision: 0,
          turnTimeRemainingMs: 10_000,
        },
      ]),
    )
    if (packet.type !== PacketType.GAME_START) throw new Error('Expected a start.')
    expect(packet.descriptor.config.boardSize).toBe(5)
    expect(packet.descriptor.config.streak).toBe(4)
  })

  it('rejects malformed or unsupported authoritative start descriptors', () => {
    const descriptor = {
      matchId: 'match-1',
      engine: { id: 'classic', revision: 1 },
      config: DEFAULT_GAME_CONFIG,
      seed: 42,
      firstSeat: 0,
      revision: 0,
      turnTimeRemainingMs: 10_000,
    }

    for (const replacement of [
      { ...descriptor, matchId: '' },
      { ...descriptor, engine: { id: 'classic', revision: 2 } },
      // Out-of-range values must be rejected, not silently clamped: the server
      // is required to send an already-clamped config.
      { ...descriptor, config: { ...DEFAULT_GAME_CONFIG, rounds: 999 } },
      { ...descriptor, config: { ...DEFAULT_GAME_CONFIG, boardSize: 7 } },
      { ...descriptor, seed: -1 },
      { ...descriptor, firstSeat: 2 },
      { ...descriptor, revision: 1 },
      { ...descriptor, turnTimeRemainingMs: -1 },
    ]) {
      expect(() =>
        decodePacket(encode([0, PacketType.GAME_START, 7, replacement])),
      ).toThrow()
    }
  })

  it('decodes accepted and rejected authoritative updates defensively', () => {
    const accepted = {
      status: 'accepted',
      matchId: 'match-1',
      commandId: 3,
      fromRevision: 4,
      toRevision: 5,
      actorSeat: 0,
      commands: [{ type: 'place', locationId: 2, symbol: 'rock' }],
      events: [{
        type: 'placements-committed',
        seat: 0,
        placements: [{ locationId: 2, symbol: 'rock' }],
      }],
      turnTimeRemainingMs: 9_500,
    }
    expect(decodePacket(encode([0, PacketType.GAME_UPDATE, accepted]))).toEqual({
      type: PacketType.GAME_UPDATE,
      update: accepted,
    })

    const rejected = {
      status: 'rejected',
      matchId: 'match-1',
      commandId: 3,
      currentRevision: 4,
      reason: 'location-occupied',
    }
    expect(decodePacket(encode([0, PacketType.GAME_UPDATE, rejected]))).toEqual({
      type: PacketType.GAME_UPDATE,
      update: rejected,
    })

    for (const invalid of [
      { ...accepted, actorSeat: 3 },
      { ...accepted, commands: [{ type: 'timeout', extra: true }] },
      { ...accepted, events: [{ type: 'mystery' }] },
      { ...accepted, fromRevision: -1 },
      { ...rejected, reason: 'invented-reason' },
      { ...rejected, currentRevision: 1.5 },
    ]) {
      expect(() =>
        decodePacket(encode([0, PacketType.GAME_UPDATE, invalid])),
      ).toThrow()
    }
  })

  it('encodes revisioned commands and excludes client timeout commands', () => {
    expect(
      decode(
        encodeGameCommandPacket(7, {
          matchId: 'match-1',
          commandId: 3,
          expectedRevision: 4,
          command: { type: 'place', locationId: 2, symbol: 'rock' },
        }),
      ),
    ).toEqual([
      7,
      PacketType.GAME_COMMAND,
      {
        matchId: 'match-1',
        commandId: 3,
        expectedRevision: 4,
        command: { type: 'place', locationId: 2, symbol: 'rock' },
      },
    ])

    expect(() =>
      encodeGameCommandPacket(7, {
        matchId: 'match-1',
        commandId: 4,
        expectedRevision: 4,
        command: { type: 'timeout' } as never,
      }),
    ).toThrow('timeout')
  })

  it('encodes the proposed config as a keyed trailing map', () => {
    expect(
      decode(
        encodeMatchmakingPacket(7, true, {
          ...DEFAULT_GAME_CONFIG,
          rounds: 8,
          turnSeconds: 15,
          blindMode: false,
        }),
      ),
    ).toEqual([
      7,
      PacketType.MATCHMAKING_REQUEST,
      true,
      { ...DEFAULT_GAME_CONFIG, rounds: 8, turnSeconds: 15, blindMode: false },
    ])
  })

  it('clamps an authoritative match-found config and defaults a missing map', () => {
    expect(
      decodePacket(
        encode([
          0,
          PacketType.MATCH_FOUND,
          'room-1',
          { ...DEFAULT_GAME_CONFIG, rounds: 999, turnSeconds: 0 },
        ]),
      ),
    ).toEqual({
      type: PacketType.MATCH_FOUND,
      roomId: 'room-1',
      config: { ...DEFAULT_GAME_CONFIG, rounds: 20, turnSeconds: 2 },
    })
    expect(decodePacket(encode([0, PacketType.MATCH_FOUND, 'room-2']))).toEqual({
      type: PacketType.MATCH_FOUND,
      roomId: 'room-2',
      config: DEFAULT_GAME_CONFIG,
    })
    // A malformed field falls back on its own; the rest of the config survives.
    expect(
      decodePacket(
        encode([
          0,
          PacketType.MATCH_FOUND,
          'room-3',
          { ...DEFAULT_GAME_CONFIG, boardSize: 5, streak: 4, turnSeconds: 'bad' },
        ]),
      ),
    ).toEqual({
      type: PacketType.MATCH_FOUND,
      roomId: 'room-3',
      config: { ...DEFAULT_GAME_CONFIG, boardSize: 5, streak: 4 },
    })
  })

  /*
   * The client no longer encodes these three: all gameplay leaves through
   * GAME_COMMAND, and the server answers a legacy packet with
   * `legacy-gameplay-disabled`. Decoding them still has to work. A stray legacy
   * frame must stay a silent no-op rather than a decode failure, because
   * NetworkClient turns any decode failure into a terminal sync-lost.
   * Wire shapes are written out literally here rather than round-tripped
   * through an encoder, so the assertions pin the format itself.
   */
  it('decodes a legacy game move relay', () => {
    const packet = decodePacket(encode([7, PacketType.GAME_MOVE, 4, 'green']))

    expect(packet).toEqual({
      type: PacketType.GAME_MOVE,
      senderId: 7,
      index: 4,
      color: COLOR_GREEN,
    })
  })

  it('decodes a legacy extra-turn relay carrying parallel index and colour arrays', () => {
    const packet = decodePacket(
      encode([3, PacketType.GAME_MOVES, [0, 8], ['red', 'green']]),
    )

    expect(packet).toEqual({
      type: PacketType.GAME_MOVES,
      senderId: 3,
      moves: [
        { index: 0, color: COLOR_RED },
        { index: 8, color: COLOR_GREEN },
      ],
    })
  })

  it('decodes a legacy immune relay', () => {
    const packet = decodePacket(encode([5, PacketType.IMMUNE_UPDATE, [2, 6]]))

    expect(packet).toEqual({
      type: PacketType.IMMUNE_UPDATE,
      senderId: 5,
      indices: [2, 6],
    })
  })
})
