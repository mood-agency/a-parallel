/**
 * AsyncMutex — single-holder async lock for protecting read-modify-write sequences.
 *
 * In-process only. Does NOT provide cross-process locking.
 * Suitable for single-process applications like the pipeline service.
 */

export class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  /**
   * Acquire the lock. Returns a release function.
   * If already locked, waits until the current holder releases.
   */
  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => resolve(this.createRelease()));
    });
  }

  /**
   * Execute a function while holding the lock.
   * Ensures the lock is released even if the function throws.
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  get isLocked(): boolean {
    return this.locked;
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return; // idempotent
      released = true;

      const next = this.queue.shift();
      if (next) {
        next(); // pass lock to next waiter
      } else {
        this.locked = false;
      }
    };
  }
}
