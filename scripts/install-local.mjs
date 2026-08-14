#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { chmod, cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const RELEASE_INPUTS = [
  'HARNESS.md',
  'README.md',
  'package.json',
  'bin',
  'src',
  'scripts',
  'skills',
  'docs/reference',
  'spikes/browser-space',
];

function parseArguments(arguments_) {
  const command = arguments_[0];
  if (!['install', 'uninstall'].includes(command)) throw new Error('Usage: install-local.mjs install|uninstall [--install-root PATH] [--bin-dir PATH]');
  const options = {
    command,
    installRoot: process.env.SIGLOO_INSTALL_ROOT ?? join(homedir(), '.local', 'share', 'sigloo'),
    binDirectory: process.env.SIGLOO_BIN_DIR ?? join(homedir(), '.local', 'bin'),
  };
  for (let index = 1; index < arguments_.length; index += 1) {
    const token = arguments_[index];
    if (!['--install-root', '--bin-dir'].includes(token) || !arguments_[index + 1]) throw new Error(`Unknown or incomplete option: ${token}`);
    if (token === '--install-root') options.installRoot = arguments_[index + 1];
    else options.binDirectory = arguments_[index + 1];
    index += 1;
  }
  options.installRoot = resolve(options.installRoot);
  options.binDirectory = resolve(options.binDirectory);
  return options;
}

async function filesUnder(path, root, selected) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) throw new Error(`Release input cannot be a symlink: ${relative(root, path)}`);
  if (metadata.isFile()) {
    selected.push(path);
    return;
  }
  for (const name of (await readdir(path)).sort()) await filesUnder(join(path, name), root, selected);
}

async function releaseDigest() {
  const files = [];
  for (const input of RELEASE_INPUTS) await filesUnder(join(SOURCE_ROOT, input), SOURCE_ROOT, files);
  const hash = createHash('sha256');
  for (const path of files.sort()) {
    hash.update(relative(SOURCE_ROOT, path));
    hash.update('\0');
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

async function harden(path, root = path) {
  const metadata = await lstat(path);
  if (metadata.isDirectory()) {
    await chmod(path, 0o700);
    for (const name of await readdir(path)) await harden(join(path, name), root);
  } else {
    const relativePath = relative(root, path);
    const executable = ['bin/sigloo.mjs', 'scripts/install-local.mjs'].includes(relativePath);
    await chmod(path, executable ? 0o700 : 0o600);
  }
}

async function install({ installRoot, binDirectory }) {
  const digest = await releaseDigest();
  const releaseId = digest.slice('sha256:'.length);
  const releasesRoot = join(installRoot, 'releases');
  const release = join(releasesRoot, releaseId);
  await mkdir(releasesRoot, { recursive: true, mode: 0o700 });
  await chmod(installRoot, 0o700);
  await chmod(releasesRoot, 0o700);
  let releaseExists = true;
  try {
    await lstat(release);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    releaseExists = false;
  }
  if (releaseExists) {
    const metadata = await lstat(release);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`Refusing invalid existing release: ${release}`);
    }
    const manifest = JSON.parse(await readFile(join(release, 'release.json'), 'utf8'));
    if (manifest.digest !== digest) throw new Error(`Existing release digest mismatch: ${release}`);
  } else {
    const temporary = join(releasesRoot, `.${releaseId}.${process.pid}.${randomUUID()}.tmp`);
    await mkdir(temporary, { mode: 0o700 });
    try {
      for (const input of RELEASE_INPUTS) {
        const destination = join(temporary, input);
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await cp(join(SOURCE_ROOT, input), destination, { recursive: true, errorOnExist: true });
      }
      await writeFile(join(temporary, 'release.json'), `${JSON.stringify({ schema_version: 1, digest }, null, 2)}\n`, { mode: 0o600 });
      await harden(temporary);
      await rename(temporary, release);
    } catch (copyError) {
      await rm(temporary, { recursive: true, force: true });
      throw copyError;
    }
  }
  await mkdir(binDirectory, { recursive: true, mode: 0o700 });
  const commandPath = join(binDirectory, 'sigloo');
  const target = join(release, 'bin', 'sigloo.mjs');
  try {
    const metadata = await lstat(commandPath);
    if (!metadata.isSymbolicLink()) throw new Error(`Refusing to replace non-symlink command: ${commandPath}`);
    const existingTarget = resolve(dirname(commandPath), await readlink(commandPath));
    if (!existingTarget.startsWith(`${join(installRoot, 'releases')}${sep}`)) {
      throw new Error(`Refusing to replace command outside Sigloo releases: ${commandPath}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporaryLink = join(binDirectory, `.sigloo.${process.pid}.${randomUUID()}.tmp`);
  await symlink(target, temporaryLink);
  await rename(temporaryLink, commandPath);
  return { status: 'installed', digest, release, command: commandPath };
}

async function uninstall({ installRoot, binDirectory }) {
  const commandPath = join(binDirectory, 'sigloo');
  const metadata = await lstat(commandPath);
  if (!metadata.isSymbolicLink()) throw new Error(`Refusing to remove non-symlink command: ${commandPath}`);
  const target = resolve(dirname(commandPath), await readlink(commandPath));
  const releaseRoot = `${join(installRoot, 'releases')}${sep}`;
  if (!target.startsWith(releaseRoot)) throw new Error('Refusing to remove a command not owned by this install root');
  await rm(commandPath);
  return { status: 'uninstalled', command: commandPath, retained_data_root: installRoot };
}

try {
  const options = parseArguments(process.argv.slice(2));
  const result = options.command === 'install' ? await install(options) : await uninstall(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`sigloo installer: ${error.message}\n`);
  process.exitCode = 2;
}
