# Deploying to Unraid 7

Gridiron Heads ships as a single Docker container that serves both the
React client and the Express + Socket.IO server on port 3000. The image
is pushed to GitHub Container Registry (GHCR) by CI; Unraid pulls from
there and a Cloudflare Tunnel on the Unraid host exposes it publicly.

```
                           Cloudflare edge
                                  |
                                  v
                        cloudflared (Unraid host)
                                  |
                                  v
   http://localhost:3000  <-----  gridiron-heads container
                                  |
                                  v
                       /mnt/user/appdata/gridiron-heads/data/gridiron.db
```

## 1. Publish the image (one-time)

Push to `main` (or a `v*` tag) on GitHub. The workflow at
`.github/workflows/docker.yml` builds and pushes `linux/amd64` images to
`ghcr.io/<owner>/gridiron-heads` with these tags:

- `latest` on every push to `main`
- `<sha>` on every push to `main`
- `<version>`, `<major>.<minor>` on `v*` tag pushes

GHCR packages are private by default — make the image public in the
GitHub Packages UI, or use a Personal Access Token with `read:packages`
scope in the Unraid GHCR login.

## 2. Install the Unraid template

Copy `unraid-template.xml` from this repo to:

```
/boot/config/plugins/dockerMan/templates-user/gridiron-heads.xml
```

(You can also drop it into a Community Apps repo and submit a PR if you
want it discoverable.)

Then in the Unraid WebUI: **Docker → Add Container → gridiron-heads**.

Fill in:

| Field                    | Value                                          |
| ------------------------ | ---------------------------------------------- |
| Repository               | `ghcr.io/<owner>/gridiron-heads`               |
| Tag                      | `latest` (or pin to a SHA for reproducibility) |
| Host Port → Container    | `3000` → `3000`                                |
| Appdata                  | `/mnt/user/appdata/gridiron-heads/data`        |

Click **Apply**. The container starts, the healthcheck flips green
within ~15s.

## 3. Point a Cloudflare Tunnel at it

On the Unraid host, install `cloudflared` (Community Apps has it as
`cloudflared` or use the official binary):

```bash
cloudflared tunnel login
cloudflared tunnel create gridiron-heads
cloudflared tunnel route dns gridiron-heads grid.example.com
```

In `/etc/cloudflared/config.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: grid.example.com
    service: http://localhost:3000
  - service: http_status:404
```

```bash
cloudflared tunnel run gridiron-heads
```

Cloudflare Tunnel forwards WebSocket upgrades transparently — Socket.IO
"just works" because the server already honors `X-Forwarded-Proto`
(`app.set('trust proxy', 1)`).

## 4. Verify

- `https://grid.example.com/` returns the SPA.
- `https://grid.example.com/healthz` returns `{"ok":true}`.
- Open two browsers, create a game, share the `/join/<id>` URL, play.

## Local dev with the same image

```bash
docker build -t gridiron-heads:dev .
docker run --rm -p 3000:3000 -v ./data:/app/data gridiron-heads:dev
# open http://localhost:3000
```

Or `docker compose up --build`.

## Persistent data

The SQLite database lives at `/app/data/gridiron.db` inside the
container. The `DB_PATH` env var can override the path but should always
point to a directory on the host volume (`/mnt/user/appdata/...`) so
sessions survive container recreation. `server/src/db.ts` will `mkdir -p`
the parent dir on first boot if needed.

## Upgrading

1. Push to `main` → CI builds a new image with a fresh `<sha>` tag.
2. In Unraid, **Docker → gridiron-heads → Force Update** (or pull the
   pinned tag manually).
3. The container restarts with the new image; `/app/data` is reused, so
   in-flight session state persists across upgrades.

## Troubleshooting

- **`/healthz` never goes green** — check `docker logs gridiron-heads`.
  Common cause: port collision on the host (Unraid shows this in the
  container's log too).
- **WebSocket drops every ~100s** — almost always a Cloudflare Tunnel
  idle timeout. Add `warp-routing` or set the tunnel `keep-alive` to
  match the upstream. The server itself sends a Socket.IO ping every
  25s by default.
- **Empty player names** — see AGENTS.md §7. `localStorage` must persist
  the `gridiron:player_name:<sessionId>` entry. Cloudflare doesn't
  affect this; it's purely client-side.