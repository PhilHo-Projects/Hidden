import {
  argon2,
  randomBytes,
  timingSafeEqual,
  type Argon2Algorithm,
} from 'node:crypto'

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/
const MIN_PASSWORD_CHARACTERS = 10
const MAX_PASSWORD_CHARACTERS = 128
const MAX_PASSWORD_BYTES = 512
const ARGON2_MEMORY_KIB = 19_456
const ARGON2_PASSES = 2
const ARGON2_PARALLELISM = 1
const ARGON2_TAG_LENGTH = 32
const ARGON2_VERSION = 19
const SALT_LENGTH = 16
const HASH_PREFIX = '$hidden$argon2id$'

export interface Credentials {
  username: string
  usernameKey: string
  password: string
}

export class CredentialValidationError extends Error {
  constructor(
    readonly field: 'username' | 'password',
    message: string,
  ) {
    super(message)
    this.name = 'CredentialValidationError'
  }
}

export function parseCredentials(value: unknown): Credentials {
  if (!value || typeof value !== 'object') {
    throw new CredentialValidationError(
      'username',
      'Username and password are required.',
    )
  }

  const body = value as Record<string, unknown>
  const username =
    typeof body.username === 'string' ? body.username.trim() : ''
  if (!USERNAME_PATTERN.test(username)) {
    throw new CredentialValidationError(
      'username',
      'Username must contain 3–24 letters, numbers, or underscores.',
    )
  }

  if (typeof body.password !== 'string') {
    throw new CredentialValidationError(
      'password',
      'Password must contain 10–128 characters.',
    )
  }

  const password = body.password
  const characterCount = Array.from(password).length
  const byteCount = Buffer.byteLength(password, 'utf8')
  if (
    characterCount < MIN_PASSWORD_CHARACTERS ||
    characterCount > MAX_PASSWORD_CHARACTERS ||
    byteCount > MAX_PASSWORD_BYTES
  ) {
    throw new CredentialValidationError(
      'password',
      'Password must contain 10–128 characters.',
    )
  }

  return {
    username,
    usernameKey: username.toLowerCase(),
    password,
  }
}

function deriveArgon2id(
  password: string,
  salt: Buffer,
  parameters: {
    memory: number
    passes: number
    parallelism: number
    tagLength: number
  },
) {
  return new Promise<Buffer>((resolve, reject) => {
    argon2(
      'argon2id' as Argon2Algorithm,
      {
        message: Buffer.from(password, 'utf8'),
        nonce: salt,
        memory: parameters.memory,
        passes: parameters.passes,
        parallelism: parameters.parallelism,
        tagLength: parameters.tagLength,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error)
          return
        }
        resolve(derivedKey)
      },
    )
  })
}

export async function hashPassword(password: string) {
  const salt = randomBytes(SALT_LENGTH)
  const hash = await deriveArgon2id(password, salt, {
    memory: ARGON2_MEMORY_KIB,
    passes: ARGON2_PASSES,
    parallelism: ARGON2_PARALLELISM,
    tagLength: ARGON2_TAG_LENGTH,
  })

  return [
    HASH_PREFIX.slice(0, -1),
    `v=${ARGON2_VERSION}`,
    `m=${ARGON2_MEMORY_KIB},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM},l=${ARGON2_TAG_LENGTH}`,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$')
}

interface ParsedHash {
  salt: Buffer
  hash: Buffer
  memory: number
  passes: number
  parallelism: number
  tagLength: number
}

function parsePasswordHash(encoded: string): ParsedHash | undefined {
  const match =
    /^\$hidden\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+),l=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(
      encoded,
    )
  if (!match) {
    return undefined
  }

  const [, memory, passes, parallelism, tagLength, salt, hash] = match
  const parsed = {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: Number(tagLength),
    salt: Buffer.from(salt!, 'base64url'),
    hash: Buffer.from(hash!, 'base64url'),
  }
  if (
    !Number.isInteger(parsed.memory) ||
    !Number.isInteger(parsed.passes) ||
    !Number.isInteger(parsed.parallelism) ||
    !Number.isInteger(parsed.tagLength) ||
    parsed.salt.length < 8 ||
    parsed.hash.length !== parsed.tagLength
  ) {
    return undefined
  }
  return parsed
}

export async function verifyPassword(encoded: string, password: string) {
  const parsed = parsePasswordHash(encoded)
  if (!parsed) {
    return false
  }

  try {
    const actual = await deriveArgon2id(password, parsed.salt, parsed)
    return (
      actual.length === parsed.hash.length &&
      timingSafeEqual(actual, parsed.hash)
    )
  } catch {
    return false
  }
}
