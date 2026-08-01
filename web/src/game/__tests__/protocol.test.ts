import { COLOR_GREEN, COLOR_RED } from '../constants'
import { decode, encode } from '@msgpack/msgpack'
import {
  decodePacket,
  encodeGameMovePacket,
  encodeGameMovesPacket,
  encodeImmunePacket,
  encodeMatchmakingPacket,
  LOBBY_ROOM_ID,
  PacketType,
} from '../protocol'
import { DEFAULT_MATCH_RULES } from '../matchRules'

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

  it('keeps active packet ids stable', () => {
    expect(PacketType.MATCHMAKING_REQUEST).toBe(13)
    expect(PacketType.MATCH_FOUND).toBe(14)
    expect(PacketType.GAME_START).toBe(15)
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
            mode: { id: 'classic', revision: 1 },
            rules: DEFAULT_MATCH_RULES,
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
    })
  })

  it('encodes proposed rules as a keyed trailing map', () => {
    expect(
      decode(
        encodeMatchmakingPacket(7, true, {
          rounds: 8,
          turnSeconds: 15,
          blindMode: false,
        }),
      ),
    ).toEqual([
      7,
      PacketType.MATCHMAKING_REQUEST,
      true,
      { rounds: 8, turnSeconds: 15, blindMode: false },
    ])
  })

  it('decodes authoritative rules and defaults a missing or malformed map', () => {
    expect(
      decodePacket(
        encode([
          0,
          PacketType.MATCH_FOUND,
          'room-1',
          { rounds: 999, turnSeconds: 0, blindMode: false },
        ]),
      ),
    ).toEqual({
      type: PacketType.MATCH_FOUND,
      roomId: 'room-1',
      rules: { rounds: 20, turnSeconds: 2, blindMode: false },
    })
    expect(decodePacket(encode([0, PacketType.MATCH_FOUND, 'room-2']))).toEqual({
      type: PacketType.MATCH_FOUND,
      roomId: 'room-2',
      rules: DEFAULT_MATCH_RULES,
    })
    expect(
      decodePacket(
        encode([
          0,
          PacketType.MATCH_FOUND,
          'room-3',
          { rounds: 3, turnSeconds: 'bad', blindMode: false },
        ]),
      ),
    ).toEqual({
      type: PacketType.MATCH_FOUND,
      roomId: 'room-3',
      rules: DEFAULT_MATCH_RULES,
    })
  })

  it('encodes and decodes a game move packet', () => {
    const encoded = encodeGameMovePacket(7, 4, COLOR_GREEN)
    const raw = decode(encoded) as unknown[]
    expect(raw[3]).toBe('green')

    const packet = decodePacket(encoded)

    expect(packet.type).toBe(PacketType.GAME_MOVE)
    if (packet.type !== PacketType.GAME_MOVE) {
      throw new Error('Expected game move packet')
    }

    expect(packet.senderId).toBe(7)
    expect(packet.index).toBe(4)
    expect(packet.color).toBe(COLOR_GREEN)
  })

  it('encodes and decodes extra turn packets', () => {
    const encoded = encodeGameMovesPacket(3, [
      { index: 0, color: COLOR_RED },
      { index: 8, color: COLOR_GREEN },
    ])
    const raw = decode(encoded) as unknown[]
    expect(raw[3]).toEqual(['red', 'green'])

    const packet = decodePacket(encoded)

    expect(packet.type).toBe(PacketType.GAME_MOVES)
    if (packet.type !== PacketType.GAME_MOVES) {
      throw new Error('Expected extra turn packet')
    }

    expect(packet.moves).toHaveLength(2)
    expect(packet.moves[1]?.index).toBe(8)
    expect(packet.moves[1]?.color).toBe(COLOR_GREEN)
  })

  it('encodes and decodes immune packets', () => {
    const packet = decodePacket(encodeImmunePacket(5, [2, 6]))

    expect(packet.type).toBe(PacketType.IMMUNE_UPDATE)
    if (packet.type !== PacketType.IMMUNE_UPDATE) {
      throw new Error('Expected immune packet')
    }

    expect(packet.indices).toEqual([2, 6])
  })
})
