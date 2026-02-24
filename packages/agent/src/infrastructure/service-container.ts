/**
 * Lightweight typed service container for dependency injection.
 *
 * Replaces the manual wiring in index.ts with a registry that supports:
 * - Lazy singleton instantiation
 * - Typed service retrieval
 * - Disposal of registered services
 *
 * No decorators or reflection — just a simple Map-based registry.
 */

type Factory<T> = () => T;
type Disposer = () => void | Promise<void>;

interface ServiceEntry<T = unknown> {
  factory: Factory<T>;
  instance?: T;
  disposer?: Disposer;
}

export class ServiceContainer {
  private services = new Map<string, ServiceEntry>();
  private disposed = false;

  /**
   * Register a singleton factory. The factory is called lazily on first `get()`.
   * Optionally provide a disposer for cleanup.
   */
  register<T>(key: string, factory: Factory<T>, disposer?: Disposer): void {
    if (this.disposed) throw new Error('Container is disposed');
    this.services.set(key, { factory, disposer });
  }

  /**
   * Register an already-instantiated value as a singleton.
   */
  registerInstance<T>(key: string, instance: T, disposer?: Disposer): void {
    if (this.disposed) throw new Error('Container is disposed');
    this.services.set(key, { factory: () => instance, instance, disposer });
  }

  /**
   * Get a service by key. Instantiates the singleton on first call.
   * Throws if the service is not registered.
   */
  get<T>(key: string): T {
    if (this.disposed) throw new Error('Container is disposed');
    const entry = this.services.get(key);
    if (!entry) throw new Error(`Service not registered: ${key}`);

    if (!entry.instance) {
      entry.instance = entry.factory();
    }
    return entry.instance as T;
  }

  /**
   * Check if a service is registered.
   */
  has(key: string): boolean {
    return this.services.has(key);
  }

  /**
   * Dispose all services that have registered disposers.
   * After disposal, the container cannot be used.
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    const disposers = [...this.services.values()]
      .filter((e) => e.disposer)
      .map((e) => e.disposer!);

    for (const disposer of disposers) {
      try {
        await disposer();
      } catch {
        // Swallow disposal errors to ensure all disposers run
      }
    }
    this.services.clear();
  }
}
