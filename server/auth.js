import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 32;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, KEYLEN);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function newToken() {
  return randomBytes(32).toString('hex');
}

/** 用户名规则：3-20 位字母/数字/下划线 */
export function validUsername(u) {
  return typeof u === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(u);
}

export function validPassword(p) {
  return typeof p === 'string' && p.length >= 6 && p.length <= 64;
}
