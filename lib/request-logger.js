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

const requestLogger = morgan((tokens, req, res) => {
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
    duration_ms: Number(tokens['total-time'](req, res)),
    completed
  });

  // The shared logger owns output and level filtering, not Morgan's dev stream.
  return null;
});

requestLogger.route = mount => {
  return (req, res, next) => {
    res.locals.logMount = mount;
    next();
  };
};
requestLogger.safePath = safePath;

module.exports = requestLogger;
