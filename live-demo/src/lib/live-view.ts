import { useEffect, useState } from "react"
import { read } from "./sandbox"

// Poll the local projection of the confirmed Flagsmith assignment. No SDK key
// or management credential is sent to the storefront.
export function useLiveView<T>(url: string | null, header: string, key: string, paused: boolean) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!url || paused) return
    const controller = new AbortController()
    let timer: number
    let pending = false
    async function poll() {
      if (pending || controller.signal.aborted) return
      window.clearTimeout(timer)
      pending = true
      try {
        const result = await read<T>(url!, { headers: { [header]: key }, signal: controller.signal })
        if (!controller.signal.aborted) { setData(result); setError("") }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Connection interrupted.")
      } finally {
        pending = false
        if (!controller.signal.aborted) timer = window.setTimeout(poll, document.hidden ? 4000 : 1000)
      }
    }
    void poll()
    window.addEventListener("focus", poll)
    document.addEventListener("visibilitychange", poll)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
      window.removeEventListener("focus", poll)
      document.removeEventListener("visibilitychange", poll)
    }
  }, [url, header, key, paused, revision])
  return { data, setData, error, refresh: () => setRevision(value => value + 1) }
}
