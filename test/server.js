const assert = require('assert');
const spawn = require('child_process').spawn;
const EventEmitter = require('events');
const http = require('http');
const path = require('path');

const children = [];

// Build optional child-process fixtures separately from process management.
const serverScript = notify => {
  return [
    "var http = require('http');",
    'var listen = http.Server.prototype.listen;',
    'http.Server.prototype.listen = function() {',
    "  this.once('listening', function() { require('fs').writeSync(3, String(this.address().port)); require('fs').closeSync(3); });",
    '  return listen.apply(this, arguments);',
    '};',
    ['slow', 'stalled'].includes(notify) ? [
      "require('./routes/users').stack[0].route.stack[0].handle = function(req, res) {",
      "  res.write('pending');",
      `  if (${notify === 'slow'}) { setTimeout(function() { res.end('complete'); }, 200); }`,
      '};'
    ].join('\n') : '',
    ['stdout', 'stderr'].includes(notify) ? [
      "var logger = require('./lib/logger');",
      'var flush = logger.flush;',
      "logger.flush = function(callback) { process.send({ event: 'flushing' }); flush(callback); };",
      "require('./routes/users').stack[0].route.stack[0].handle = function(req, res) {",
      '  for (var i = 0; i < 512; i++) {',
      `    logger.${notify === 'stdout' ? 'info' : 'warn'}('drain_probe', { sequence: i, padding: 'x'.repeat(1024) });`,
      '  }',
      `  process.send({ event: 'queued', buffered: process.${notify}.writableLength > 0 });`,
      "  res.end('ok');",
      '};'
    ].join('\n') : '',
    "require('./bin/www');"
  ].join('\n');
};

const startServer = (environment, notify) => {
  // A separate pipe exposes readiness in tests without sleeps or port races.
  const args = notify ? ['-e', serverScript(notify)] : [path.join(__dirname, '../bin/www')];
  const child = spawn(process.execPath, args, {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, {
      PORT: '0', LOG_LEVEL: 'info', NODE_ENV: 'production'
    }, environment),
    stdio: ['stdout', 'stderr'].includes(notify)
      ? ['ignore', 'pipe', 'pipe', 'pipe', 'ipc']
      : notify ? ['ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe']
  });
  if (notify) {
    child.ready = new Promise(resolve => child.stdio[3].once('data', chunk => resolve(Number(chunk.toString()))));
  }
  child.records = [];
  child.logs = new EventEmitter();
  child.closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  ['stdout', 'stderr'].forEach(stream => {
    let pending = '';
    child[stream].setEncoding('utf8');
    child[stream].on('data', chunk => {
      pending += chunk;
      let newline = -1;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const record = JSON.parse(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        child.records.push({ stream, record });
        child.logs.emit('record', record);
      }
    });
  });
  children.push(child);
  return child;
};

const waitForLog = (child, event) => {
  const existing = child.records.find(entry => entry.record.event === event);
  if (existing) {
    return Promise.resolve(existing.record);
  }
  return new Promise((resolve, reject) => {
    const onRecord = record => {
      if (record.event === event) {
        child.logs.removeListener('record', onRecord);
        resolve(record);
      }
    };
    child.logs.on('record', onRecord);
    child.once('close', () => {
      child.logs.removeListener('record', onRecord);
      reject(new Error(`Server closed before ${event}`));
    });
  });
};

const get = (port, route) => {
  return new Promise((resolve, reject) => {
    const client = http.get({ hostname: '127.0.0.1', port, path: route, agent: false }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
      res.on('error', reject);
    });
    client.on('error', reject);
  });
};

describe('Server lifecycle logging', function() {
  this.timeout(7000);

  afterEach(async () => {
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      await child.closed;
    }
  });

  ['SIGTERM', 'SIGINT'].forEach(signal => {
    it(`logs startup and preserves termination by ${signal}`, async () => {
      const child = startServer();
      const listening = await waitForLog(child, 'server_listening');
      assert.strictEqual(listening.level, 'info');
      assert(listening.port > 0);
      assert.strictEqual(await get(listening.port, '/users?private=do-not-log-this'), 200);
      child.kill(signal);
      const result = await child.closed;
      assert.deepStrictEqual(result, { code: null, signal });
      assert.deepStrictEqual(child.records.map(entry => entry.record.event), [
        'server_listening', 'request_complete', 'server_stopping', 'server_stopped'
      ]);
      assert.strictEqual(child.records[2].record.signal, signal);
      assert(!JSON.stringify(child.records).includes('do-not-log-this'));
      assert(child.records.every(entry => entry.stream === 'stdout'));
    });

    it(`forces shutdown within the deadline and preserves ${signal}`, async function() {
      this.timeout(15000);
      const child = startServer({}, 'stalled');
      const port = await child.ready;
      await new Promise((resolve, reject) => {
        const client = http.get({ hostname: '127.0.0.1', port, path: '/users', agent: false }, res => {
          res.once('data', resolve);
          res.on('error', error => {
            // The forced signal intentionally disconnects this unfinished response.
            if (error.code !== 'ECONNRESET') {
              reject(error);
            }
          });
          res.resume();
        });
        client.on('error', reject);
      });
      const started = process.hrtime.bigint();
      child.kill(signal);
      assert.deepStrictEqual(await child.closed, { code: null, signal });
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      assert(elapsedMs >= 9900 && elapsedMs < 14000);
      assert.deepStrictEqual(child.records.map(entry => entry.record.event), [
        'server_listening', 'server_stopping', 'server_shutdown_timeout'
      ]);
      assert.strictEqual(child.records[2].record.level, 'error');
      assert.strictEqual(child.records[2].stream, 'stderr');
    });
  });

  ['stdout', 'stderr'].forEach(stream => {
    it(`flushes queued ${stream} records before signal termination`, async () => {
      const child = startServer({}, stream);
      const port = await child.ready;
      child[stream].pause();
      try {
        const queued = new Promise(resolve => child.once('message', resolve));
        assert.strictEqual(await get(port, '/users'), 200);
        assert.deepStrictEqual(await queued, { event: 'queued', buffered: true });
        const flushing = new Promise((resolve, reject) => {
          child.once('message', resolve);
          child.once('exit', () => reject(new Error('Terminated before flushing output')));
        });
        child.kill('SIGTERM');
        assert.deepStrictEqual(await flushing, { event: 'flushing' });
        assert.strictEqual(child.exitCode, null);
        assert.strictEqual(child.signalCode, null);
      } finally {
        child[stream].resume();
      }
      assert.deepStrictEqual(await child.closed, { code: null, signal: 'SIGTERM' });
      const probes = child.records.filter(entry => entry.record.event === 'drain_probe');
      assert.strictEqual(probes.length, 512);
      assert(probes.every((entry, index) => entry.record.sequence === index && entry.stream === stream));
      assert(child.records.some(entry => entry.record.event === 'server_stopped'));
    });
  });

  it('retains the shutdown deadline when a collector never drains', async function() {
    this.timeout(15000);
    const child = startServer({}, 'stdout');
    const port = await child.ready;
    child.stdout.pause();
    let result = null;
    try {
      const queued = new Promise(resolve => child.once('message', resolve));
      assert.strictEqual(await get(port, '/users'), 200);
      assert.deepStrictEqual(await queued, { event: 'queued', buffered: true });
      const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
      const started = process.hrtime.bigint();
      child.kill('SIGTERM');
      result = await exited;
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      assert(elapsedMs >= 9900 && elapsedMs < 14000);
    } finally {
      child.stdout.resume();
    }
    assert.deepStrictEqual(result, { code: null, signal: 'SIGTERM' });
    await child.closed;
  });

  it('drains an active response before logging a clean shutdown', async () => {
    const child = startServer({}, 'slow');
    const port = await child.ready;
    const response = new Promise((resolve, reject) => {
      const client = http.get({ hostname: '127.0.0.1', port, path: '/users', agent: false }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.once('data', () => child.kill('SIGTERM'));
        res.on('end', () => resolve(body));
        res.on('error', reject);
      });
      client.on('error', reject);
    });
    assert.strictEqual(await response, 'pendingcomplete');
    assert.deepStrictEqual(await child.closed, { code: null, signal: 'SIGTERM' });
    assert.deepStrictEqual(child.records.map(entry => entry.record.event), [
      'server_listening', 'server_stopping', 'request_complete', 'server_stopped'
    ]);
    assert.strictEqual(child.records[2].record.completed, true);
  });

  it('reports port conflicts as structured errors and exits nonzero', async () => {
    const occupied = http.createServer();
    await new Promise(resolve => occupied.listen(0, resolve));
    try {
      const child = startServer({ PORT: String(occupied.address().port) });
      const result = await child.closed;
      assert.strictEqual(result.code, 1);
      assert.strictEqual(child.records.length, 1);
      assert.strictEqual(child.records[0].stream, 'stderr');
      assert.strictEqual(child.records[0].record.event, 'server_error');
      assert.strictEqual(child.records[0].record.code, 'EADDRINUSE');
      assert.strictEqual(child.records[0].record.level, 'error');
    } finally {
      await new Promise(resolve => occupied.close(resolve));
    }
  });

  it('logs synchronous startup errors without raw exception output', async () => {
    const child = startServer({ PORT: '65536' });
    assert.strictEqual((await child.closed).code, 1);
    assert.strictEqual(child.records.length, 1);
    assert.strictEqual(child.records[0].record.event, 'server_error');
    assert.strictEqual(child.records[0].record.code, 'UNKNOWN');
    assert.strictEqual(child.records[0].stream, 'stderr');
  });

  ['warn', 'silent'].forEach(level => {
    it(`applies LOG_LEVEL=${level} to HTTP and lifecycle records`, async () => {
      const child = startServer({ LOG_LEVEL: level }, true);
      const port = await child.ready;
      assert.strictEqual(await get(port, '/users'), 200);
      assert.strictEqual(await get(port, '/do-not-log-this'), 404);
      child.kill('SIGTERM');
      assert.deepStrictEqual(await child.closed, { code: null, signal: 'SIGTERM' });
      assert.strictEqual(child.records.length, level === 'warn' ? 1 : 0);
      if (level === 'warn') {
        assert.strictEqual(child.records[0].record.event, 'request_complete');
        assert.strictEqual(child.records[0].record.status, 404);
        assert.strictEqual(child.records[0].stream, 'stderr');
      }
      assert(!JSON.stringify(child.records).includes('do-not-log-this'));
    });
  });
});
