import * as fs from 'fs';
import * as path from 'path';
import { getLodyDataDir } from './installation-profile';

/**
 * Lock file directory:
 * - default: ~/.lody/locks/
 * - override: $LODY_LOCKS_DIR
 */
function resolveLocksDir(override?: string): string {
  const fromOptions = override?.trim();
  if (fromOptions) return path.resolve(fromOptions);

  const fromEnv = process.env.LODY_LOCKS_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  return path.join(getLodyDataDir(), 'locks');
}

/**
 * Ensure the locks directory exists
 */
function ensureLocksDir(locksDir: string): void {
  fs.mkdirSync(locksDir, { recursive: true });
}

/**
 * Get the lock file path for a given lock name
 */
function getLockPath(locksDir: string, lockName: string): string {
  // Sanitize lock name to be filesystem safe
  const safeName = lockName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(locksDir, `${safeName}.lock`);
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a lock is stale (process that created it is no longer running)
 */
function isLockStale(lockPath: string, maxAgeMs: number = 30 * 60 * 1000): boolean {
  try {
    const content = fs.readFileSync(lockPath, 'utf8');
    const lockInfo = JSON.parse(content) as { pid: number; timestamp: number };

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
function tryAcquireLock(lockPath: string): boolean {
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
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EEXIST') {
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
function releaseLock(lockPath: string): void {
  try {
    // Verify we own the lock before releasing
    const content = fs.readFileSync(lockPath, 'utf8');
    const lockInfo = JSON.parse(content) as { pid: number };

    if (lockInfo.pid === process.pid) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Ignore errors during release
  }
}

export interface LockOptions {
  /** Maximum time to wait for lock in ms (default: 30000) */
  timeout?: number;
  /** Initial retry delay in ms (default: 100) */
  retryDelay?: number;
  /** Maximum retry delay in ms (default: 2000) */
  maxRetryDelay?: number;
  /** Override directory to store lock files (defaults to ~/.lody/locks) */
  locksDir?: string;
}

/**
 * Acquire a file lock and execute a function
 *
 * @param lockName - Name of the lock (will be sanitized for filesystem)
 * @param fn - Function to execute while holding the lock
 * @param options - Lock options
 */
export async function withFileLock<T>(
  lockName: string,
  fn: () => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
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
export function cleanupStaleLocks(): void {
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
