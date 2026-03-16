/**
 * Path Sandbox — standalone test suite
 *
 * Run: node --experimental-vm-modules server/utils/__tests__/pathSandbox.test.js
 *
 * No test framework required — uses Node.js assert + a tiny runner.
 */

import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { enforceSandbox, analyseBashCommand, isPathWithinProject } from '../pathSandbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '../../..'); // repo root

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

// ─── enforceSandbox tests ───────────────────────────────────────────────────

console.log('\n== enforceSandbox ==');

await test('rm /etc/passwd → denied', async () => {
  const r = await enforceSandbox('Bash', { command: 'rm /etc/passwd' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, false);
});

await test('rm ./node_modules/foo → allowed (project-internal)', async () => {
  const r = await enforceSandbox('Bash', { command: 'rm ./node_modules/foo' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, true);
});

await test('rm ../../../etc/passwd → denied (traversal)', async () => {
  const r = await enforceSandbox('Bash', { command: 'rm ../../../etc/passwd' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, false);
});

await test('mv ./file /tmp/file → denied (destination outside)', async () => {
  const r = await enforceSandbox('Bash', { command: 'mv ./file /tmp/file' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, false);
});

await test('mv ./a ./b → allowed (both inside)', async () => {
  const r = await enforceSandbox('Bash', { command: 'mv ./a ./b' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, true);
});

await test('rm $(echo /etc) → denied (shell expansion)', async () => {
  const r = await enforceSandbox('Bash', { command: 'rm $(echo /etc)' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, false);
});

await test('cat /etc/passwd → allowed (read-only tool)', async () => {
  const r = await enforceSandbox('Read', { file_path: '/etc/passwd' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, true);
});

await test('Grep → always allowed', async () => {
  const r = await enforceSandbox('Grep', { pattern: 'test', path: '/etc' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, true);
});

await test('Write to /etc/hosts → denied', async () => {
  const r = await enforceSandbox('Write', { file_path: '/etc/hosts' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, false);
});

await test('Write to project file → allowed', async () => {
  const r = await enforceSandbox('Write', { file_path: path.join(PROJECT_DIR, 'test.txt') }, PROJECT_DIR);
  assert.strictEqual(r.allowed, true);
});

await test('Edit to /usr/local/bin/foo → denied', async () => {
  const r = await enforceSandbox('Edit', { file_path: '/usr/local/bin/foo' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, false);
});

await test('No projectDir → deny destructive, allow read-only', async () => {
  const r1 = await enforceSandbox('Bash', { command: 'rm foo' }, null);
  assert.strictEqual(r1.allowed, false);
  const r2 = await enforceSandbox('Read', { file_path: '/etc/hosts' }, null);
  assert.strictEqual(r2.allowed, true);
});

await test('Bash with chained commands: ls && rm /etc/passwd → denied', async () => {
  const r = await enforceSandbox('Bash', { command: 'ls && rm /etc/passwd' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, false);
});

await test('Bash with pipe (non-destructive): cat foo | grep bar → allowed', async () => {
  const r = await enforceSandbox('Bash', { command: 'cat foo | grep bar' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, true);
});

await test('Bash rm -rf /tmp → denied (outside project)', async () => {
  const r = await enforceSandbox('Bash', { command: 'rm -rf /tmp' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, false);
});

await test('Bash redirect to outside: echo foo > /etc/test → denied', async () => {
  const r = await enforceSandbox('Bash', { command: 'echo foo > /etc/test' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, false);
});

await test('Bash redirect inside project → allowed', async () => {
  const r = await enforceSandbox('Bash', { command: `echo foo > ${path.join(PROJECT_DIR, 'out.txt')}` }, PROJECT_DIR);
  assert.strictEqual(r.allowed, true);
});

await test('Unknown tool with path field outside → denied', async () => {
  const r = await enforceSandbox('SomeNewTool', { file_path: '/etc/shadow' }, PROJECT_DIR);
  assert.strictEqual(r.allowed, false);
});

await test('Unknown tool with path field inside → allowed', async () => {
  const r = await enforceSandbox('SomeNewTool', { file_path: path.join(PROJECT_DIR, 'a.txt') }, PROJECT_DIR);
  assert.strictEqual(r.allowed, true);
});

// ─── analyseBashCommand tests ───────────────────────────────────────────────

console.log('\n== analyseBashCommand ==');

await test('simple rm → extracts path', () => {
  const r = analyseBashCommand('rm /foo/bar');
  assert.deepStrictEqual(r.destructivePaths, ['/foo/bar']);
  assert.strictEqual(r.error, null);
});

await test('rm -rf → extracts path, skips flags', () => {
  const r = analyseBashCommand('rm -rf /foo/bar');
  assert.deepStrictEqual(r.destructivePaths, ['/foo/bar']);
});

await test('mv src dst → both paths captured', () => {
  const r = analyseBashCommand('mv /a /b');
  assert.deepStrictEqual(r.destructivePaths, ['/a', '/b']);
});

await test('non-destructive command → no paths', () => {
  const r = analyseBashCommand('ls -la /etc');
  assert.deepStrictEqual(r.destructivePaths, []);
});

await test('shell expansion with destructive cmd → error', () => {
  const r = analyseBashCommand('rm $(whoami)');
  assert.notStrictEqual(r.error, null);
});

await test('shell expansion without destructive cmd → no error', () => {
  const r = analyseBashCommand('echo $(date)');
  assert.strictEqual(r.error, null);
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
