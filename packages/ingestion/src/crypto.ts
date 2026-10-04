import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  createPrivateKey,
  sign,
} from 'node:crypto';
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function seal(value: string, key: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function unseal(value: string, key: string) {
  const bytes = Buffer.from(value, 'base64');
  const cipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'base64'),
    bytes.subarray(0, 12),
  );
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    cipher.update(bytes.subarray(28)),
    cipher.final(),
  ]).toString('utf8');
}
export function appJwt(appId: string, privateKeyBase64: string) {
  const now = Math.floor(Date.now() / 1000);
  const body = [
    { alg: 'RS256', typ: 'JWT' },
    { iat: now - 60, exp: now + 540, iss: appId },
  ]
    .map((v) => Buffer.from(JSON.stringify(v)).toString('base64url'))
    .join('.');
  return (
    body +
    '.' +
    sign(
      'RSA-SHA256',
      Buffer.from(body),
      createPrivateKey(Buffer.from(privateKeyBase64, 'base64')),
    ).toString('base64url')
  );
}
