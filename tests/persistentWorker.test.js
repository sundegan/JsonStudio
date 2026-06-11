import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentWorker } from '../src/lib/services/persistentWorker.js';

class FakeWorker {
  static instances = [];

  constructor() {
    this.messages = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    FakeWorker.instances.push(this);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  respond(result, messageIndex = 0) {
    const message = this.messages[messageIndex];
    this.onmessage?.({ data: { id: message.id, ok: true, result } });
  }

  fail(message = 'worker failed') {
    this.onerror?.({ message });
  }

  terminate() {
    this.terminated = true;
  }
}

function createFakePersistentWorker(factory = () => new FakeWorker()) {
  FakeWorker.instances = [];
  return createPersistentWorker(factory);
}

test('persistent worker reuses its worker after a task completes', async () => {
  const runner = createFakePersistentWorker();
  const first = runner.run({ content: '{}' });
  const worker = FakeWorker.instances[0];

  worker.respond('first');
  assert.equal(await first.promise, 'first');

  const second = runner.run({ content: '[]' });
  assert.equal(FakeWorker.instances.length, 1);
  assert.equal(worker.messages.length, 2);
  worker.respond('second', 1);
  assert.equal(await second.promise, 'second');
});

test('cancelling active work replaces the worker and ignores its late errors', async () => {
  const runner = createFakePersistentWorker();
  const cancelled = runner.run({ content: 'large' });
  const oldWorker = FakeWorker.instances[0];

  cancelled.cancel();
  await assert.rejects(cancelled.promise, { name: 'AbortError' });
  assert.equal(oldWorker.terminated, true);

  const next = runner.run({ content: '{}' });
  const replacement = FakeWorker.instances[1];
  oldWorker.fail('late error from cancelled worker');
  assert.equal(replacement.terminated, false);
  replacement.respond('next');
  assert.equal(await next.promise, 'next');
});

test('persistent worker rejects worker creation failures', async () => {
  const error = new Error('worker unavailable');
  const runner = createFakePersistentWorker(() => {
    throw error;
  });

  await assert.rejects(runner.run({}).promise, error);
});

test('persistent worker rejects postMessage failures and recreates the worker', async () => {
  let createdWorkers = 0;
  const runner = createFakePersistentWorker(() => {
    const nextWorker = new FakeWorker();
    if (createdWorkers++ === 0) {
      nextWorker.postMessage = () => {
        throw new DOMException('Cannot clone payload', 'DataCloneError');
      };
    }
    return nextWorker;
  });

  await assert.rejects(runner.run({ content: () => {} }).promise, {
    name: 'DataCloneError',
  });
  assert.equal(FakeWorker.instances[0].terminated, true);

  const recovered = runner.run({ content: '{}' });
  assert.equal(FakeWorker.instances.length, 2);
  FakeWorker.instances[1].respond('recovered');
  assert.equal(await recovered.promise, 'recovered');
});
