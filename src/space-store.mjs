import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const DEFAULT_TTL_MS = 30 * 60 * 1_000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

function validateTtlMs(ttlMs) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > MAX_TTL_MS) {
    throw new SpaceError('INVALID_TTL', 'TTL must be between 1s and 7d', 2);
  }
}

export class SpaceError extends Error {
  constructor(code, message, exitCode) {
    super(message);
    this.name = 'SpaceError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function parseTtl(value = '30m') {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) throw new SpaceError('INVALID_TTL', 'TTL must use s, m, h or d, for example 30m', 2);
  const units = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const ttlMs = Number(match[1]) * units[match[2]];
  validateTtlMs(ttlMs);
  return ttlMs;
}

function validateName(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new SpaceError('INVALID_SPACE_NAME', 'Space name must be 1-64 letters, numbers, dots, underscores or hyphens', 2);
  }
}

function validateOwner(ownerId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(ownerId)) {
    throw new SpaceError('INVALID_OWNER', 'SIGLOO_OWNER_ID has an invalid format', 2);
  }
}

function defaultOwnerId() {
  return process.env.SIGLOO_OWNER_ID ?? `uid:${process.getuid?.() ?? 'unknown'}`;
}

function publicRecord(record) {
  return {
    schema_version: record.schema_version,
    id: record.id,
    name: record.name,
    owner_id: record.owner_id,
    state: record.state,
    ttl_ms: record.ttl_ms,
    created_at: record.created_at,
    expires_at: record.expires_at,
    updated_at: record.updated_at,
    artifact_path: record.directories.artifacts,
    work_path: record.directories.work,
    last_run: record.last_run,
    cleanup: record.cleanup,
  };
}

export class SpaceStore {
  constructor({
    dataRoot = process.env.SIGLOO_DATA_ROOT ?? join(homedir(), '.local', 'share', 'sigloo'),
    ownerId = defaultOwnerId(),
    now = () => new Date(),
  } = {}) {
    validateOwner(ownerId);
    this.dataRoot = resolve(dataRoot);
    this.ownerId = ownerId;
    this.now = now;
    this.recordsRoot = join(this.dataRoot, 'records');
    this.spacesRoot = join(this.dataRoot, 'spaces');
  }

  async initialize() {
    await mkdir(this.recordsRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.spacesRoot, { recursive: true, mode: 0o700 });
    await chmod(this.dataRoot, 0o700);
    await chmod(this.recordsRoot, 0o700);
    await chmod(this.spacesRoot, 0o700);
  }

  async create(name, ttlMs = DEFAULT_TTL_MS) {
    validateName(name);
    validateTtlMs(ttlMs);
    await this.initialize();
    const existing = (await this.#records()).find((record) =>
      record.owner_id === this.ownerId && record.name === name && ['ready', 'running'].includes(record.state)
        && !this.#expired(record));
    if (existing) throw new SpaceError('SPACE_NAME_IN_USE', `Active Space name is already in use: ${name}`, 5);

    const id = `${name}-${randomUUID()}`;
    const root = join(this.spacesRoot, id);
    const directories = {
      root,
      work: join(root, 'work'),
      artifacts: join(root, 'artifacts'),
      evidence: join(root, 'evidence'),
    };
    await Promise.all(Object.values(directories).map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
    const createdAt = this.now();
    const record = {
      schema_version: 1,
      id,
      name,
      owner_id: this.ownerId,
      state: 'ready',
      ttl_ms: ttlMs,
      created_at: createdAt.toISOString(),
      expires_at: new Date(createdAt.getTime() + ttlMs).toISOString(),
      updated_at: createdAt.toISOString(),
      directories,
      last_run: null,
      cleanup: null,
    };
    await this.#write(record);
    return publicRecord(record);
  }

  async list() {
    await this.initialize();
    const records = await this.#records();
    for (const record of records) {
      if (this.#expired(record) && ['ready', 'running', 'completed'].includes(record.state)) {
        await this.#expire(record);
      }
    }
    return (await this.#records())
      .filter((record) => record.owner_id === this.ownerId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map(publicRecord);
  }

  async inspect(identifier) {
    return publicRecord(await this.#owned(identifier));
  }

  async report(identifier) {
    const record = await this.#owned(identifier, { allowExpired: true });
    const evidencePath = record.last_run?.evidence_path;
    if (!evidencePath) throw new SpaceError('SPACE_REPORT_NOT_FOUND', 'Space has no completed run report', 4);
    const expectedRoot = `${resolve(record.directories.evidence)}${sep}`;
    const canonicalPath = resolve(evidencePath);
    if (!canonicalPath.startsWith(expectedRoot)) throw new SpaceError('SPACE_REPORT_INVALID', 'Space report path is invalid', 5);
    try {
      return JSON.parse(await readFile(canonicalPath, 'utf8'));
    } catch {
      throw new SpaceError('SPACE_REPORT_INVALID', 'Space report cannot be read', 5);
    }
  }

  async resolveRunnable(identifier) {
    const record = await this.#owned(identifier);
    if (!['ready', 'running'].includes(record.state)) {
      throw new SpaceError('SPACE_NOT_RUNNABLE', `Space is not runnable in state ${record.state}`, 5);
    }
    return record;
  }

  async recordRun(identifier, { status, evidencePath }) {
    const record = await this.#owned(identifier);
    if (!['ready', 'running'].includes(record.state)) {
      throw new SpaceError('SPACE_NOT_RUNNABLE', `Space is not runnable in state ${record.state}`, 5);
    }
    const updatedAt = this.now().toISOString();
    const updated = {
      ...record,
      state: 'ready',
      updated_at: updatedAt,
      last_run: { status, evidence_path: evidencePath, finished_at: updatedAt },
    };
    await this.#write(updated);
    return publicRecord(updated);
  }

  async complete(identifier) {
    const record = await this.#owned(identifier);
    if (!['ready', 'running'].includes(record.state)) {
      throw new SpaceError('SPACE_NOT_COMPLETABLE', `Space cannot complete from state ${record.state}`, 5);
    }
    const updated = { ...record, state: 'completed', updated_at: this.now().toISOString() };
    await this.#write(updated);
    return publicRecord(updated);
  }

  async destroy(identifier) {
    const record = await this.#owned(identifier, { allowExpired: true });
    if (record.state === 'destroyed') return publicRecord(record);
    return publicRecord(await this.#cleanup(record, 'destroyed'));
  }

  async #owned(identifier, { allowExpired = false } = {}) {
    await this.initialize();
    const records = await this.#records();
    const candidates = records.filter((record) => record.id === identifier || record.name === identifier);
    if (candidates.length === 0) throw new SpaceError('SPACE_NOT_FOUND', `Space not found: ${identifier}`, 4);
    const owned = candidates
      .filter((record) => record.owner_id === this.ownerId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
    if (!owned) throw new SpaceError('SPACE_OWNER_MISMATCH', 'Space belongs to a different owner', 3);
    if (this.#expired(owned) && ['ready', 'running', 'completed'].includes(owned.state)) {
      const expired = await this.#expire(owned);
      if (!allowExpired) throw new SpaceError('SPACE_EXPIRED', `Space expired: ${identifier}`, 4);
      return expired;
    }
    return owned;
  }

  #expired(record) {
    return this.now().getTime() >= Date.parse(record.expires_at);
  }

  async #expire(record) {
    return this.#cleanup(record, 'expired');
  }

  async #cleanup(record, state) {
    await rm(record.directories.root, { recursive: true, force: true });
    const cleanedAt = this.now().toISOString();
    const updated = {
      ...record,
      state,
      updated_at: cleanedAt,
      cleanup: {
        reason: state,
        space_directory_removed: true,
        resources_remaining: false,
        cleaned_at: cleanedAt,
      },
    };
    await this.#write(updated);
    return updated;
  }

  async #records() {
    let names = [];
    try { names = await readdir(this.recordsRoot); } catch { return []; }
    const records = [];
    for (const name of names.filter((entry) => entry.endsWith('.json'))) {
      try {
        records.push(JSON.parse(await readFile(join(this.recordsRoot, name), 'utf8')));
      } catch {
        throw new SpaceError('SPACE_RECORD_INVALID', `Space record is invalid: ${name}`, 5);
      }
    }
    return records;
  }

  async #write(record) {
    const path = join(this.recordsRoot, `${record.id}.json`);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600);
  }
}
