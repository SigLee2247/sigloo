#!/usr/bin/env node

import assert from 'node:assert/strict';
import { access, lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.equal(packageJson.name, 'sigloo');
assert.match(packageJson.version, /^0\.\d+\.\d+$/);
assert.ok(Number(process.versions.node.split('.')[0]) >= 20);
const bin = join(root, packageJson.bin.sigloo);
await access(bin);
assert.equal((await lstat(bin)).isSymbolicLink(), false);
process.stdout.write(`${JSON.stringify({ status: 'passed', package: packageJson.name, version: packageJson.version, node: process.version, bin }, null, 2)}\n`);
