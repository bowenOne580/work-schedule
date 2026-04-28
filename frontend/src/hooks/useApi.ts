import { useState, useEffect, useCallback, useRef } from 'react'

// Simple in-memory cache shared across all hook instances
const cache = new Map<string, { data: unknown; ts: number }>()
const listeners = new Map<string, Set<() => void>>()
const STALE_MS = 30_000

function notify(key: string) {
  listeners.get(key)?.forEach(fn => fn())
}

export function invalidate(key: string) {
  cache.delete(key)
  notify(key)
}

export function invalidatePrefix(prefix: string) {
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) {
      cache.delete(k)
      notify(k)
    }
  }
}

export function setCache(key: string, data: unknown) {
  cache.set(key, { data, ts: Date.now() })
  notify(key)
}

export function useQuery<T>(key: string, fetcher: () => Promise<T>, enabled = true) {
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: unknown }>({
    data: (cache.get(key)?.data as T) ?? undefined,
    loading: !cache.has(key) && enabled,
    error: undefined,
  })

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const load = useCallback(async () => {
    const cached = cache.get(key)
    if (cached && Date.now() - cached.ts < STALE_MS) {
      setState(s => ({ ...s, data: cached.data as T, loading: false }))
      return
    }
    setState(s => ({ ...s, loading: true, error: undefined }))
    try {
      const data = await fetcherRef.current()
      cache.set(key, { data, ts: Date.now() })
      setState({ data, loading: false, error: undefined })
      notify(key)
    } catch (err) {
      setState(s => ({ ...s, loading: false, error: err }))
    }
  }, [key])

  useEffect(() => {
    if (!enabled) return
    const set = listeners.get(key) ?? new Set()
    const handler = () => {
      const cached = cache.get(key)
      if (cached) setState(s => ({ ...s, data: cached.data as T }))
      else load()
    }
    set.add(handler)
    listeners.set(key, set)
    load()
    return () => { set.delete(handler) }
  }, [key, enabled, load])

  return { ...state, refetch: load }
}

export function useMutation<TArg, TResult = unknown>(
  fn: (arg: TArg) => Promise<TResult>,
  opts?: { onSuccess?: (result: TResult, arg: TArg) => void; onError?: (err: unknown) => void }
) {
  const [pending, setPending] = useState(false)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const optsRef = useRef(opts)
  optsRef.current = opts

  const mutate = useCallback(async (arg: TArg) => {
    setPending(true)
    try {
      const result = await fnRef.current(arg)
      optsRef.current?.onSuccess?.(result, arg)
      return result
    } catch (err) {
      optsRef.current?.onError?.(err)
      throw err
    } finally {
      setPending(false)
    }
  }, [])

  return { mutate, pending }
}
