// Base URL of the FastAPI backend. Vite exposes env vars prefixed with VITE_
// to browser code; in production this points at the deployed API.
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export interface HealthResponse {
  status: string
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_URL}/health`)
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
  return res.json()
}
