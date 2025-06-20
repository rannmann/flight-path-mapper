const fs = require('fs');
const path = require('path');

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

class Logger {
  constructor(level = 'INFO') {
    this.level = LOG_LEVELS[level.toUpperCase()] || LOG_LEVELS.INFO;
    this.logDir = 'logs';
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  _shouldLog(level) {
    return LOG_LEVELS[level] <= this.level;
  }

  _formatMessage(level, message, data) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${level}: ${message}`;
    return data ? `${formatted} ${JSON.stringify(data)}` : formatted;
  }

  _log(level, message, data) {
    if (!this._shouldLog(level)) return;

    const formatted = this._formatMessage(level, message, data);
    console.log(formatted);

    // Also write to log file
    const logFile = path.join(this.logDir, `${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logFile, formatted + '\n');
  }

  error(message, data) {
    this._log('ERROR', message, data);
  }

  warn(message, data) {
    this._log('WARN', message, data);
  }

  info(message, data) {
    this._log('INFO', message, data);
  }

  debug(message, data) {
    this._log('DEBUG', message, data);
  }

  // Progress logging for long-running operations
  progress(current, total, operation) {
    const percentage = Math.round((current / total) * 100);
    this.info(`${operation}: ${current}/${total} (${percentage}%)`);
  }
}

// Create default logger instance
const logger = new Logger(process.env.LOG_LEVEL || 'INFO');

// Export both the class and the default instance
module.exports = logger;
module.exports.Logger = Logger;