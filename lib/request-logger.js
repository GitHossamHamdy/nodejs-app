var morgan = require('morgan');
var logger = require('./logger');

// Only application-defined route templates are safe to log. Never fall back
// to originalUrl: unknown paths and route parameters may contain secrets.
function safePath(req, res) {
  if (!req.route || typeof req.route.path !== 'string') {
    return '[unmatched]';
  }
  return (res.locals.logMount || '') + req.route.path;
}

var requestLogger = morgan(function(tokens, req, res) {
  var status = res.headersSent ? res.statusCode : null;
  var completed = res.writableFinished;
  var level = !completed || status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

  logger[level]('request_complete', {
    method: req.method,
    path: safePath(req, res),
    status: status,
    duration_ms: Number(tokens['total-time'](req, res)),
    completed: completed
  });

  // The shared logger owns output and level filtering, not Morgan's dev stream.
  return null;
});

requestLogger.route = function(mount) {
  return function(req, res, next) {
    res.locals.logMount = mount;
    next();
  };
};
requestLogger.safePath = safePath;

module.exports = requestLogger;
