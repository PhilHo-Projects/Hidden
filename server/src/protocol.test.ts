import { encode } from '@msgpack/msgpack'
import { describe, expect, it } from 'vitest'
import {
  decodeClientPacket,
  PacketType,
  ProtocolError,
} from './protocol'

describe('decodeClientPacket', () => {
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

  it('rejects unsupported and malformed packets', () => {
    expect(() => decodeClientPacket(encode({ type: 'move' }))).toThrow(
      ProtocolError,
    )
    expect(() => decodeClientPacket(encode([1, 999, true]))).toThrow(
      ProtocolError,
    )
  })
})
