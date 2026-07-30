/**
 * Registry that isolates mutable action handlers by Stream Deck action ID.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/**
 * Lazily creates and owns one handler for each physical key/action context.
 */
export class PerKeyHandlerRegistry<T> {
  private readonly handlers = new Map<string, T>();

  constructor(private readonly createHandler: () => T) {}

  get(actionId: string): T {
    let handler = this.handlers.get(actionId);
    if (!handler) {
      handler = this.createHandler();
      this.handlers.set(actionId, handler);
    }
    return handler;
  }

  take(actionId: string): T | undefined {
    const handler = this.handlers.get(actionId);
    this.handlers.delete(actionId);
    return handler;
  }
}
