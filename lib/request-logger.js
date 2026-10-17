const morgan = require('morgan');
const logger = require('./logger');

// Only application-defined route templates are safe to log. Never fall back
// to originalUrl: unknown paths and route parameters may contain secrets.
const safePath = (req, res) => {
  if (!req.route || typeof req.route.path !== 'string') {
    return '[unmatched]';
  }
  return (res.locals.logMount || '') + req.route.path;
};

const activeRequests = new Map();
const completionLogger = morgan((_tokens, _req, res) => {
  const complete = activeRequests.get(res);
  if (complete) {
    complete();
  }
  // The shared logger owns output and level filtering, not Morgan's dev stream.
  return null;
});

const requestLogger = (req, res, next) => {
  // Morgan's total-time is unavailable if no response headers were written.
  const started = process.hrtime.bigint();
  activeRequests.set(res, () => {
    if (!activeRequests.delete(res)) {
      return;
    }
    const status = res.headersSent ? res.statusCode : null;
    const completed = res.writableFinished;
    let level = status >= 400 ? 'warn' : 'info';
    if (!completed || status >= 500) {
      level = 'error';
    }
    logger[level]('request_complete', {
      method: req.method,
      path: safePath(req, res),
      status,
      duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
      completed
    });
  });
  completionLogger(req, res, next);
};

// Record unfinished responses before a fatal shutdown signal, not after it.
// Removing each entry also prevents a later Morgan callback from duplicating it.
requestLogger.finalizeOutstanding = () => {
  activeRequests.forEach(complete => complete());
};

requestLogger.route = mount => {
  return (req, res, next) => {
    res.locals.logMount = mount;
    next();
  };
};
requestLogger.safePath = safePath;

module.exports = requestLogger;
