const levels = { debug: 10, info: 20, warn: 30, error: 40, silent: 50 };

const createLogger = (options = {}) => {
  const configuredLevel = String(options.level || 'info').trim().toLowerCase();
  const threshold = Object.prototype.hasOwnProperty.call(levels, configuredLevel)
    ? levels[configuredLevel]
    : levels.info;
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const logger = {};

  ['debug', 'info', 'warn', 'error'].forEach(level => {
    logger[level] = (event, fields) => {
      if (levels[level] < threshold) {
        return;
      }

      const record = Object.assign({}, fields, {
        timestamp: new Date().toISOString(),
        level,
        event
      });
      const stream = levels[level] >= levels.warn ? stderr : stdout;
      stream.write(`${JSON.stringify(record)}\n`);
    };
  });

  return logger;
};

module.exports = createLogger({ level: process.env.LOG_LEVEL });
module.exports.createLogger = createLogger;
