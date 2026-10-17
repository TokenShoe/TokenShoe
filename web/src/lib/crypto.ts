/**
 * AES-256-GCM encryption for the sign-project private key.
 * The master key comes from SIGN_KEY_SECRET (64 hex chars = 32 bytes). A database leak alone does not expose plaintext keys.
 * Stored format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { env } from './env'

function masterKey(): Buffer {
  return Buffer.from(env.SIGN_KEY_SECRET, 'hex')
}

export function encryptPrivKey(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`
}

export function decryptPrivKey(stored: string): string {
  const [ivHex, tagHex, ctHex] = stored.split(':')
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(ctHex, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}
