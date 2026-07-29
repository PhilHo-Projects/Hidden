type IsStopping = () => boolean

export class RuntimeLifecycle {
  private stopping = false
  private startupPromise: Promise<void> | undefined
  private shutdownPromise: Promise<void> | undefined

  constructor(
    private readonly startRuntime: (isStopping: IsStopping) => Promise<void>,
    private readonly stopRuntime: () => Promise<void>,
  ) {}

  start() {
    if (!this.startupPromise) {
      this.startupPromise = this.stopping
        ? Promise.resolve()
        : this.startRuntime(() => this.stopping)
    }
    return this.startupPromise
  }

  stop() {
    if (!this.shutdownPromise) {
      this.stopping = true
      this.shutdownPromise = (async () => {
        await this.startupPromise?.catch(() => undefined)
        await this.stopRuntime()
      })()
    }
    return this.shutdownPromise
  }
}
