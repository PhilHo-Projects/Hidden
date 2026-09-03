import { useEffect, useRef, useState } from 'react'

interface TurnstileRenderOptions {
  sitekey: string
  theme: 'dark'
  callback(token: string): void
  'expired-callback'(): void
  'error-callback'(): void
}

export interface TurnstileApi {
  render(
    container: HTMLElement,
    options: TurnstileRenderOptions,
  ): string
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

interface TurnstileWidgetProps {
  siteKey: string
  resetKey: number
  onTokenChange(token: string | null): void
  api?: TurnstileApi
}

const SCRIPT_ID = 'hidden-turnstile-script'
let turnstilePromise: Promise<TurnstileApi> | undefined

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (turnstilePromise) return turnstilePromise
  turnstilePromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    const script = existing ?? document.createElement('script')
    const loaded = () => {
      if (window.turnstile) resolve(window.turnstile)
      else reject(new Error('Turnstile did not initialize.'))
    }
    script.addEventListener('load', loaded, { once: true })
    script.addEventListener(
      'error',
      () => reject(new Error('Turnstile failed to load.')),
      { once: true },
    )
    if (!existing) {
      script.id = SCRIPT_ID
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      document.head.append(script)
    }
  }).catch((error) => {
    turnstilePromise = undefined
    throw error
  })
  return turnstilePromise
}

export function TurnstileWidget({
  siteKey,
  resetKey,
  onTokenChange,
  api,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const callbackRef = useRef(onTokenChange)
  const apiRef = useRef<TurnstileApi | undefined>(undefined)
  const widgetIdRef = useRef<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    callbackRef.current = onTokenChange
  }, [onTokenChange])

  useEffect(() => {
    if (!siteKey || !containerRef.current) return
    let active = true
    void (api ? Promise.resolve(api) : loadTurnstile())
      .then((loadedApi) => {
        if (!active || !containerRef.current) return
        apiRef.current = loadedApi
        widgetIdRef.current = loadedApi.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'dark',
          callback: (token) => callbackRef.current(token),
          'expired-callback': () => callbackRef.current(null),
          'error-callback': () => callbackRef.current(null),
        })
        setFailed(false)
      })
      .catch(() => {
        if (active) {
          setFailed(true)
          callbackRef.current(null)
        }
      })

    return () => {
      active = false
      if (widgetIdRef.current) {
        apiRef.current?.remove(widgetIdRef.current)
        widgetIdRef.current = undefined
      }
    }
  }, [api, siteKey])

  useEffect(() => {
    if (!widgetIdRef.current) return
    apiRef.current?.reset(widgetIdRef.current)
    callbackRef.current(null)
  }, [resetKey])

  if (!siteKey) {
    return (
      <p className="turnstile-status" role="status">
        Bot check is not configured. Account actions are unavailable.
      </p>
    )
  }

  return (
    <div className="turnstile-wrap">
      <div ref={containerRef} aria-label="Bot verification" />
      {failed ? (
        <p className="turnstile-status" role="status">
          Bot check could not load. Check your connection and try again.
        </p>
      ) : null}
    </div>
  )
}
