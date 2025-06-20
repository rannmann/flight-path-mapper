const fs = require('fs');
const path = require('path');
const { Logger } = require('../lib/logger');

// Mock fs for testing
jest.mock('fs');

describe('Logger', () => {
  let logger;
  let consoleLogSpy;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock fs methods
    fs.existsSync.mockReturnValue(true);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.appendFileSync.mockReturnValue(undefined);
    
    // Spy on console.log
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    
    logger = new Logger('DEBUG');
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  test('should create logs directory if it does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    new Logger();
    
    expect(fs.mkdirSync).toHaveBeenCalledWith('logs', { recursive: true });
  });

  test('should log error messages', () => {
    logger.error('Test error message');
    
    expect(consoleLogSpy).toHaveBeenCalled();
    const logMessage = consoleLogSpy.mock.calls[0][0];
    expect(logMessage).toContain('ERROR');
    expect(logMessage).toContain('Test error message');
  });

  test('should log info messages', () => {
    logger.info('Test info message');
    
    expect(consoleLogSpy).toHaveBeenCalled();
    const logMessage = consoleLogSpy.mock.calls[0][0];
    expect(logMessage).toContain('INFO');
    expect(logMessage).toContain('Test info message');
  });

  test('should respect log level', () => {
    const infoLogger = new Logger('INFO');
    infoLogger.debug('Debug message');
    
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  test('should format progress messages', () => {
    logger.progress(50, 100, 'Processing files');
    
    expect(consoleLogSpy).toHaveBeenCalled();
    const logMessage = consoleLogSpy.mock.calls[0][0];
    expect(logMessage).toContain('Processing files: 50/100 (50%)');
  });

  test('should include data in log messages', () => {
    const testData = { key: 'value', number: 42 };
    logger.info('Test message with data', testData);
    
    expect(consoleLogSpy).toHaveBeenCalled();
    const logMessage = consoleLogSpy.mock.calls[0][0];
    expect(logMessage).toContain('Test message with data');
    expect(logMessage).toContain(JSON.stringify(testData));
  });

  test('should write to log file', () => {
    logger.info('Test log file message');
    
    expect(fs.appendFileSync).toHaveBeenCalled();
    const [filePath, content] = fs.appendFileSync.mock.calls[0];
    expect(filePath).toContain('logs/');
    expect(filePath).toContain('.log');
    expect(content).toContain('Test log file message');
  });
});