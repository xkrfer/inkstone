import { useCallback, useEffect, useRef, useState } from 'react'
import { relativeTime } from './time'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

export function useBreakpoint(): Breakpoint {
  const wide = useMediaQuery('(min-width: 1180px)')
  const medium = useMediaQuery('(min-width: 768px)')
  const touchLandscape = useMediaQuery('(pointer: coarse) and (max-height: 600px) and (max-width: 1179px)')
  return touchLandscape ? 'mobile' : wide ? 'desktop' : medium ? 'tablet' : 'mobile'
}


export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}


export function useRelativeTime(timestamp: number, enabled = true): string {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled || !Number.isFinite(timestamp) || !timestamp) return
    const elapsed = Math.abs(Date.now() - timestamp)
    const delay = Math.max(1_000, 60_000 - (elapsed % 60_000))
    const timer = window.setTimeout(() => setTick((value) => value + 1), delay)
    return () => window.clearTimeout(timer)
  }, [enabled, tick, timestamp])
  return relativeTime(timestamp)
}

export function useNow(intervalMs = 60_000, enabled = true): number {
  const [tick, setTick] = useState(0)
  const interval = Number.isFinite(intervalMs) ? Math.max(1_000, Math.floor(intervalMs)) : 60_000
  useEffect(() => {
    if (!enabled) return
    const delay = Math.max(1, interval - (Date.now() % interval))
    const timer = window.setTimeout(() => setTick((value) => value + 1), delay)
    return () => window.clearTimeout(timer)
  }, [enabled, interval, tick])
  return Date.now()
}


export function useEvent<T extends (...args: never[]) => unknown>(handler: T): T {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  return useCallback(((...args: never[]) => ref.current(...args)) as T, [])
}

export function useOnlineStatus(onChange: (online: boolean) => void): void {
  const handler = useEvent(onChange)
  useEffect(() => {
    const online = () => handler(true)
    const offline = () => handler(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [handler])
}


export function useResizeObserver<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  onResize: (rect: DOMRectReadOnly) => void,
): void {
  const handler = useEvent(onResize)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) handler(entry.contentRect)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, handler])
}
