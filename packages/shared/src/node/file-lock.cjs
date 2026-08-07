const fs = require('fs');
const path = require('path');
const { getLodyDataDir } = require('./installation-profile.cjs');

/**
 * Lock file directory:
 * - default: ~/.lody/locks/
 * - override: $LODY_LOCKS_DIR
 */
function resolveLocksDir(override) {
  const fromOptions = override ? String(override).trim() : '';
  if (fromOptions) return path.resolve(fromOptions);

  const fromEnv = process.env.LODY_LOCKS_DIR ? String(process.env.LODY_LOCKS_DIR).trim() : '';
  if (fromEnv) return path.resolve(fromEnv);

  return path.join(getLodyDataDir(), 'locks');
}

/**
 * Ensure the locks directory exists
 */
function ensureLocksDir(locksDir) {
  fs.mkdirSync(locksDir, { recursive: true });
}

/**
 * Get the lock file path for a given lock name
 */
function getLockPath(locksDir, lockName) {
  // Sanitize lock name to be filesystem safe
  const safeName = String(lockName).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(locksDir, `${safeName}.lock`);
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a lock is stale (process that created it is no longer running)
 */
function isLockStale(lockPath, maxAgeMs = 30 * 60 * 1000) {
  try {
    const content = fs.readFileSync(lockPath, 'utf8');
    const lockInfo = JSON.parse(content);

    // Check if lock is too old
    if (Date.now() - lockInfo.timestamp > maxAgeMs) {
      return true;
    }

    // Check if the process is still running
    try {
      process.kill(lockInfo.pid, 0); // Signal 0 just checks if process exists
      return false; // Process exists, lock is valid
    } catch {
      return true; // Process doesn't exist, lock is stale
    }
  } catch {
    // Can't read lock file, consider it stale
    return true;
  }
}

/**
 * Try to acquire a lock file
 * Returns true if lock was acquired, false otherwise
 */
function tryAcquireLock(lockPath) {
  try {
    // Try to create lock file exclusively
    const fd = fs.openSync(lockPath, 'wx');

    // Write lock info
    const lockInfo = {
      pid: process.pid,
      timestamp: Date.now(),
    };
    fs.writeSync(fd, JSON.stringify(lockInfo));
    fs.closeSync(fd);

    return true;
  } catch (error) {
    const err = error;
    if (err && err.code === 'EEXIST') {
      // Lock file exists, check if it's stale
      if (isLockStale(lockPath)) {
        // Remove stale lock and try again
        try {
          fs.unlinkSync(lockPath);
          return tryAcquireLock(lockPath);
        } catch {
          return false;
        }
      }
      return false;
    }
    throw error;
  }
}

/**
 * Release a lock file
 */
function releaseLock(lockPath) {
  try {
    // Verify we own the lock before releasing
    const content = fs.readFileSync(lockPath, 'utf8');
    const lockInfo = JSON.parse(content);

    if (lockInfo.pid === process.pid) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Ignore errors during release
  }
}

/**
 * Acquire a file lock and execute a function
 *
 * @param lockName - Name of the lock (will be sanitized for filesystem)
 * @param fn - Function to execute while holding the lock
 * @param options - Lock options
 */
async function withFileLock(lockName, fn, options = {}) {
  const {
    timeout = 30000,
    retryDelay = 100,
    maxRetryDelay = 2000,
    locksDir: locksDirOverride,
  } = options;

  const locksDir = resolveLocksDir(locksDirOverride);
  ensureLocksDir(locksDir);
  const lockPath = getLockPath(locksDir, lockName);

  const startTime = Date.now();
  let currentDelay = retryDelay;

  // Try to acquire lock with exponential backoff
  while (true) {
    if (tryAcquireLock(lockPath)) {
      break;
    }

    // Check timeout
    if (Date.now() - startTime > timeout) {
      throw new Error(`Failed to acquire lock "${lockName}" within ${timeout}ms`);
    }

    // Wait and retry with exponential backoff
    await sleep(currentDelay);
    currentDelay = Math.min(currentDelay * 1.5, maxRetryDelay);
  }

  try {
    return await fn();
  } finally {
    releaseLock(lockPath);
  }
}

/**
 * Clean up all stale locks
 */
function cleanupStaleLocks() {
  const locksDir = resolveLocksDir();
  ensureLocksDir(locksDir);

  try {
    const files = fs.readdirSync(locksDir);
    for (const file of files) {
      if (file.endsWith('.lock')) {
        const lockPath = path.join(locksDir, file);
        if (isLockStale(lockPath)) {
          try {
            fs.unlinkSync(lockPath);
          } catch {
            // Ignore errors
          }
        }
      }
    }
  } catch {
    // Ignore errors
  }
}

module.exports = {
  withFileLock,
  cleanupStaleLocks,
};
