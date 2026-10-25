import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { MAX_BODY_BYTES, Request, readRequest } from '../src/http/request.js';

function incoming(chunks) {
  return Object.assign(Readable.from(chunks), { method: 'POST', url: '/api/generate?synthetic=1', headers: { 'x-test': 'synthetic' } });
}

test('request header lookup remains case insensitive', () => {
  assert.equal(new Request('GET', '/', { 'x-test': 'synthetic' }, '').header('X-Test'), 'synthetic');
});
test('empty body is accepted', async () => {
  const result = await readRequest(incoming([]));
  assert.equal(result.request.body, '');
  assert.equal(result.tooLarge, false);
});
test('method, path and headers are preserved', async () => {
  const result = await readRequest(incoming([Buffer.from('synthetic')]));
  assert.equal(result.request.method, 'POST');
  assert.equal(result.request.path, '/api/generate');
  assert.equal(result.request.header('X-Test'), 'synthetic');
});
test('UTF-8 bytes split across chunks are decoded together', async () => {
  const body = Buffer.from('合成の本文');
  const result = await readRequest(incoming([body.subarray(0, 2), body.subarray(2)]));
  assert.equal(result.request.body, '合成の本文');
});
test('exact byte limit remains accepted', async () => {
  const result = await readRequest(incoming([Buffer.alloc(MAX_BODY_BYTES, 'x')]));
  assert.equal(result.tooLarge, false);
  assert.equal(Buffer.byteLength(result.request.body), MAX_BODY_BYTES);
});
test('stream errors remain rejected', async () => {
  const req = new Readable({ read() { this.destroy(new Error('synthetic stream failure')); } });
  req.url = '/';
  await assert.rejects(readRequest(req), /synthetic stream failure/);
});
