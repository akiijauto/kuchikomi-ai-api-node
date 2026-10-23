import assert from 'node:assert/strict';
import { once } from 'node:events';
import { IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { MAX_BODY_BYTES, readRequest } from '../src/http/request.js';

for (const [name, chunks] of [
  ['single oversized chunk', [Buffer.alloc(MAX_BODY_BYTES + 1)]],
  ['crossing the limit', [Buffer.alloc(MAX_BODY_BYTES), Buffer.from('x')]],
  ['multibyte payload', [Buffer.from('あ'.repeat(Math.floor(MAX_BODY_BYTES / 3) + 1))]],
]) {
  test(`oversize lifecycle: ${name}`, async () => {
    const socket = new PassThrough();
    socket.on('error', () => {});
    const req = new IncomingMessage(socket);
    req.on('error', () => {});
    req.method = 'POST';
    req.url = '/api/generate';
    req.headers = {};
    try {
      for (const chunk of chunks) req.push(chunk);
      const result = await readRequest(req);
      assert.equal(result.tooLarge, true);
      assert.equal(result.request.body, '');
      assert.equal(req.destroyed, false, 'keep the request available for the error response');
      assert.equal(socket.destroyed, false, 'do not abort the transport before responding');
      const ended = once(req, 'end');
      req.push(Buffer.from('discarded remainder'));
      req.complete = true;
      req.push(null);
      await ended;
      assert.equal(req.readableEnded, true, 'the remainder is drained');
    } finally {
      req.destroy();
      socket.destroy();
    }
  });
}
