var levels = { debug: 10, info: 20, warn: 30, error: 40, silent: 50 };

function createLogger(options) {
  options = options || {};
  var configuredLevel = String(options.level || 'info').trim().toLowerCase();
  var threshold = Object.prototype.hasOwnProperty.call(levels, configuredLevel)
    ? levels[configuredLevel]
    : levels.info;
  var logger = {};

  ['debug', 'info', 'warn', 'error'].forEach(function(level) {
    logger[level] = function(event, fields) {
      if (levels[level] < threshold) {
        return;
      }

      var record = Object.assign({}, fields, {
        timestamp: new Date().toISOString(),
        level: level,
        event: event
      });
      var stream = level === 'warn' || level === 'error'
        ? (options.stderr || process.stderr)
        : (options.stdout || process.stdout);
      stream.write(JSON.stringify(record) + '\n');
    };
  });

  return logger;
}

module.exports = createLogger({ level: process.env.LOG_LEVEL });
module.exports.createLogger = createLogger;
