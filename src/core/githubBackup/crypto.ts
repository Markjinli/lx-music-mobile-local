import { AES_MODE, aesDecrypt, aesEncrypt } from '@/utils/nativeModules/crypto'
import { toMD5 } from '@/utils/tools'

const randomBytes = (len: number) => {
  let out = ''
  while (out.length < len) out += toMD5(`${Date.now()}-${Math.random()}-${out.length}`)
  return out.substring(0, len)
}

const toKeyB64 = (raw16: string) => Buffer.from(raw16, 'utf8').toString('base64')

export const createDeviceKey = () => randomBytes(32)

export const encryptBackupPayload = async(plain: string, secret: string) => {
  const salt = randomBytes(16)
  const ivRaw = randomBytes(16)
  const keyRaw = toMD5(secret + salt).substring(0, 16)
  const data = await aesEncrypt(
    Buffer.from(plain, 'utf8').toString('base64'),
    toKeyB64(keyRaw),
    toKeyB64(ivRaw),
    AES_MODE.CBC_128_PKCS7Padding,
  )
  if (!data) throw new Error('encrypt failed')
  return JSON.stringify({
    v: 1,
    alg: 'AES-CBC-128',
    salt,
    iv: Buffer.from(ivRaw, 'utf8').toString('base64'),
    data,
    updatedAt: new Date().toISOString(),
  })
}

export const decryptBackupPayload = async(encoded: string, secret: string) => {
  const payload = JSON.parse(encoded) as { v?: number, salt?: string, iv?: string, data?: string }
  if (!payload?.data || !payload.salt || !payload.iv) throw new Error('invalid backup')
  const keyRaw = toMD5(secret + payload.salt).substring(0, 16)
  const plain = await aesDecrypt(payload.data, toKeyB64(keyRaw), payload.iv, AES_MODE.CBC_128_PKCS7Padding)
  if (!plain) throw new Error('decrypt failed')
  return plain
}
