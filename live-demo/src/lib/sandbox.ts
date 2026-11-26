import { useState } from "react"

export async function read<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message ?? "The local sandbox couldn’t respond. Try again.")
  }
  return response.json() as Promise<T>
}

export function useSessionHeaders() {
  const [sessionKey] = useState(() => {
    const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("")
    try {
      const key = sessionStorage.getItem("rollback-rehearsal-session") ?? fresh()
      sessionStorage.setItem("rollback-rehearsal-session", key)
      return key
    } catch {
      return fresh()
    }
  })
  return { "X-Rehearsal-Session": sessionKey }
}
