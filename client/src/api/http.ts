// HTTP helpers for /api/sessions endpoints.

export interface CreateSessionResponse {
  session_id: string;
  player_id: string;
  /** Opaque token the client persists to localStorage; the server resolves
   *  it back to (session_id, player_id) on every reconnect. The player_id
   *  alone is no longer trusted. */
  auth_token: string;
  /** null when vs_cpu=true (no one to share with). */
  share_url: string | null;
  state: any;
}

export interface JoinSessionResponse {
  player_id: string;
  auth_token: string;
  state: any;
}

export async function createSession(
  display_name: string,
  vs_cpu: boolean = false,
): Promise<CreateSessionResponse> {
  const r = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name, vs_cpu }),
  });
  if (!r.ok) throw new Error(`createSession failed: ${r.status}`);
  return r.json();
}

export async function joinSession(
  session_id: string,
  display_name: string,
): Promise<JoinSessionResponse> {
  const r = await fetch(`/api/sessions/${session_id}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `joinSession failed: ${r.status}`);
  }
  return r.json();
}

export async function getSession(
  session_id: string,
  auth_token?: string,
): Promise<{ state: any }> {
  const headers: Record<string, string> = {};
  if (auth_token) headers['Authorization'] = `Bearer ${auth_token}`;
  const r = await fetch(`/api/sessions/${session_id}`, { headers });
  if (!r.ok) throw new Error(`getSession failed: ${r.status}`);
  return r.json();
}
