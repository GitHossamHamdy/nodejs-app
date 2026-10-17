const assert = require('assert');
const express = require('express');
const http = require('http');
const request = require('supertest');
const app = require('../app');
const logger = require('../lib/logger');
const requestLogger = require('../lib/request-logger');

const memoryLogger = level => {
  const stdout = [];
  const stderr = [];
  return {
    logger: logger.createLogger({
      level,
      stdout: { write: line => stdout.push(JSON.parse(line)) },
      stderr: { write: line => stderr.push(JSON.parse(line)) }
    }),
    stdout,
    stderr
  };
};

describe('Structured logger', () => {
  it('emits JSON with UTC timestamps and routes severity to the right stream', () => {
    const output = memoryLogger();
    output.logger.debug('hidden');
    output.logger.info('started', { port: 3000 });
    output.logger.warn('warning');
    output.logger.error('failed');
    assert.deepStrictEqual(output.stdout.map(record => record.event), ['started']);
    assert.deepStrictEqual(output.stderr.map(record => record.level), ['warn', 'error']);
    assert.strictEqual(output.stdout[0].level, 'info');
    assert.strictEqual(output.stdout[0].port, 3000);
    assert.strictEqual(new Date(output.stdout[0].timestamp).toISOString(), output.stdout[0].timestamp);
  });

  ['debug', 'info', 'warn', 'error', 'silent'].forEach((level, index) => {
    it(`filters at the ${level} threshold`, () => {
      const output = memoryLogger(level);
      ['debug', 'info', 'warn', 'error'].forEach(severity => output.logger[severity](severity));
      assert.strictEqual(output.stdout.length + output.stderr.length, Math.max(4 - index, 0));
    });
  });

  it('handles case and whitespace and falls back safely for invalid levels', () => {
    const warning = memoryLogger(' WARN ');
    warning.logger.info('hidden');
    warning.logger.warn('visible');
    assert.strictEqual(warning.stdout.length, 0);
    assert.strictEqual(warning.stderr.length, 1);
    ['invalid', '__proto__', 'constructor'].forEach(level => {
      const output = memoryLogger(level);
      output.logger.info('visible');
      assert.strictEqual(output.stdout.length, 1);
    });
  });

  it('does not let fields replace the timestamp, severity or event', () => {
    const output = memoryLogger();
    output.logger.info('actual', { event: 'fake', level: 'error', timestamp: 'fake' });
    assert.strictEqual(output.stdout[0].event, 'actual');
    assert.strictEqual(output.stdout[0].level, 'info');
    assert.notStrictEqual(output.stdout[0].timestamp, 'fake');
  });
});

describe('HTTP logging', () => {
  let records = [];
  let originalStdout = null;
  let originalStderr = null;

  beforeEach(() => {
    records = [];
    originalStdout = process.stdout.write;
    originalStderr = process.stderr.write;
    function capture(original) {
      return function(...args) {
        const chunk = args[0];
        if (typeof chunk === 'string' && chunk[0] === '{') {
          records.push(JSON.parse(chunk));
          return true;
        }
        return original.apply(this, args);
      };
    }
    process.stdout.write = capture(originalStdout);
    process.stderr.write = capture(originalStderr);
  });

  afterEach(() => {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  });

  it('logs one completed request with route, status and duration', async () => {
    await request(app).get('/users?private=do-not-log-this').expect(200);
    assert.strictEqual(records.length, 1);
    const record = records[0];
    assert.strictEqual(record.event, 'request_complete');
    assert.strictEqual(record.level, 'info');
    assert.strictEqual(record.method, 'GET');
    assert.strictEqual(record.path, '/users/');
    assert.strictEqual(record.status, 200);
    assert.strictEqual(record.completed, true);
    assert.strictEqual(typeof record.duration_ms, 'number');
    assert(Number.isFinite(record.duration_ms) && record.duration_ms >= 0);
    assert(!JSON.stringify(records).includes('do-not-log-this'));
  });

  it('redacts unknown paths, headers, cookies, bodies and query values', async () => {
    await request(app).post('/do-not-log-this?private=do-not-log-this')
      .set('Authorization', 'do-not-log-this')
      .set('Cookie', 'private=do-not-log-this')
      .send({ private: 'do-not-log-this' }).expect(404);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].path, '[unmatched]');
    assert.strictEqual(records[0].level, 'warn');
    assert.strictEqual(records[0].status, 404);
    assert(!JSON.stringify(records).includes('do-not-log-this'));
  });

  it('does not expose malformed JSON parser errors', async () => {
    await request(app).post('/users').set('Content-Type', 'application/json')
      .send('{do-not-log-this').expect(400);
    assert.strictEqual(records[0].status, 400);
    assert.strictEqual(records[0].level, 'warn');
    assert(!JSON.stringify(records).includes('do-not-log-this'));
  });

  it('uses templates rather than parameter values for mounted routers', async () => {
    const example = express();
    const router = express.Router();
    router.get('/:id', (req, res) => res.send('ok'));
    example.use(requestLogger);
    example.use('/accounts/:tenant', requestLogger.route('/accounts/:tenant'), router);
    await request(example).get('/accounts/do-not-log-this/do-not-log-this').expect(200);
    assert.strictEqual(records[0].path, '/accounts/:tenant/:id');
    assert(!JSON.stringify(records).includes('do-not-log-this'));
  });

  it('logs static responses without a raw URL', async () => {
    await request(app).get('/stylesheets/style.css?private=do-not-log-this').expect(200);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].path, '[unmatched]');
    assert(!JSON.stringify(records).includes('do-not-log-this'));
  });

  it('logs application failures without raw error messages or stacks', async () => {
    const router = require('../routes/users');
    const layer = router.stack[0].route.stack[0];
    const original = layer.handle;
    layer.handle = (req, res, next) => {
      next(new Error('do-not-log-this'));
    };
    try {
      await request(app).get('/users').expect(500);
      assert.deepStrictEqual(records.map(record => record.event), ['application_error', 'request_complete']);
      records.forEach(record => {
        assert.strictEqual(record.level, 'error');
        assert.strictEqual(record.path, '/users/');
        assert.strictEqual(record.status, 500);
      });
      assert(!JSON.stringify(records).includes('do-not-log-this'));
    } finally {
      layer.handle = original;
    }
  });

  it('records disconnected responses exactly once at error level', done => {
    const example = express();
    const server = http.createServer(example);
    example.use(requestLogger);
    example.get('/stream', (req, res) => {
      res.write('partial');
      res.on('close', () => {
        setImmediate(() => {
          server.close(() => {
            try {
              assert.strictEqual(records.length, 1);
              assert.strictEqual(records[0].completed, false);
              assert.strictEqual(records[0].level, 'error');
              assert.strictEqual(records[0].status, 200);
              done();
            } catch (error) {
              done(error);
            }
          });
        });
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const client = http.get({ hostname: '127.0.0.1', port: server.address().port, path: '/stream' }, res => {
        res.once('data', () => res.destroy());
      });
      client.on('error', done);
    });
  });
});
