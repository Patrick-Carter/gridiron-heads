// HTTP helpers for /api/sessions endpoints.

export interface CreateSessionResponse {
  session_id: string;
  player_id: string;
  /** null when vs_cpu=true (no one to share with). */
  share_url: string | null;
  state: any;
}

export interface JoinSessionResponse {
  player_id: string;
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

export async function getSession(session_id: string): Promise<{ state: any }> {
  const r = await fetch(`/api/sessions/${session_id}`);
  if (!r.ok) throw new Error(`getSession failed: ${r.status}`);
  return r.json();
}