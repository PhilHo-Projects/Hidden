import { COLOR_GREEN, COLOR_RED } from '../constants'
import { decode, encode } from '@msgpack/msgpack'
import {
  decodePacket,
  encodeGameMovePacket,
  encodeGameMovesPacket,
  encodeImmunePacket,
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
