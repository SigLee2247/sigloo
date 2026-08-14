import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function validateStringMap(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const [key, item] of Object.entries(value)) {
    if (!key || typeof item !== 'string') throw new Error(`${label} values must be strings`);
  }
}

export async function loadAuthProfile(path, invocationDirectory = process.cwd()) {
  const absolutePath = resolve(invocationDirectory, path);
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Auth Profile must be a regular file');
  if ((metadata.mode & 0o077) !== 0) throw new Error('Auth Profile permissions must be owner-only (0600)');
  if (metadata.size > 1_048_576) throw new Error('Auth Profile must not exceed 1 MiB');
  const bytes = await readFile(absolutePath);
  let profile;
  try {
    profile = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Auth Profile must contain valid JSON');
  }
  const allowed = ['schema_version', 'origin', 'cookies', 'local_storage'];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('Auth Profile must be an object');
  }
  if (Object.keys(profile).some((key) => !allowed.includes(key))) {
    throw new Error('Auth Profile contains unsupported fields');
  }
  if (profile.schema_version !== 1) throw new Error('Auth Profile schema_version must be 1');
  let origin;
  try {
    const parsed = new URL(profile.origin);
    origin = parsed.origin;
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    if (profile.origin !== origin) throw new Error();
  } catch {
    throw new Error('Auth Profile origin must be a canonical URL origin');
  }
  if (!Array.isArray(profile.cookies)) throw new Error('Auth Profile cookies must be an array');
  if (profile.cookies.length > 1_000) throw new Error('Auth Profile must not contain more than 1000 cookies');
  const cookies = profile.cookies.map((cookie) => {
    if (!cookie || typeof cookie !== 'object' || Array.isArray(cookie)) {
      throw new Error('Auth Profile cookie must be an object');
    }
    const cookieAllowed = ['name', 'value', 'path', 'secure', 'httpOnly', 'sameSite'];
    if (Object.keys(cookie).some((key) => !cookieAllowed.includes(key))) {
      throw new Error('Auth Profile cookie contains unsupported fields');
    }
    if (typeof cookie.name !== 'string' || cookie.name.length === 0 || typeof cookie.value !== 'string') {
      throw new Error('Auth Profile cookie name and value must be strings');
    }
    return { ...cookie };
  });
  validateStringMap(profile.local_storage, 'Auth Profile local_storage');
  if (Object.keys(profile.local_storage).length > 1_000) {
    throw new Error('Auth Profile must not contain more than 1000 localStorage entries');
  }

  return {
    path: absolutePath,
    digest: sha256(bytes),
    profile: {
      schema_version: 1,
      origin,
      cookies,
      local_storage: { ...profile.local_storage },
    },
  };
}
