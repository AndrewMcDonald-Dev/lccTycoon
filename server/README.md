# SCRAPCORE Versus Server

A multiplayer SSH server for **SCRAPCORE** (`games/scrap`) versus races. Multiple players (default cap: 8) connect with a plain SSH client and race simultaneously through the same seeded complex.

## Start the server

Requires **Node.js 18+**.

```bash
cd server
npm install
npm start
```

Or run directly from the repo root with options:

```bash
node server/server.js [--port 2222] [--host 0.0.0.0] [--max-players 8] [--data-dir DIR]
```

On first run, an ed25519 SSH host key is generated at `server/data/host_ed25519` (gitignored). Keep this file between restarts so returning guests do not get SSH host-key-changed warnings.

## Invite friends

Guests only need a standard SSH client and a terminal at least **100x31** (the lobby warns if the window is smaller):

```bash
ssh -p 2222 <name>@<host>
```

The SSH username becomes the player's name (letters, digits, `_`, and `-`; max 12 characters; duplicate names get a number suffix).

## Reaching it over the internet

By default the server binds to `0.0.0.0:2222` (reachable on your local network). To accept connections from outside your LAN, expose the port yourself via router port-forwarding or a VPN/tunnel such as Tailscale — the server does not configure port forwarding or tunnels on its own.

**Set `SCRAP_PASSWORD` whenever the port is reachable from the internet.**

## Password

Require a shared password by setting `SCRAP_PASSWORD`:

```bash
SCRAP_PASSWORD=your-secret npm start
```

## Options

| Flag / Env | Default | Description |
|---|---|---|
| `--port <n>` | `2222` | TCP port to listen on |
| `--host <addr>` | `0.0.0.0` | Address to bind |
| `--max-players <n>` | `8` | Maximum concurrent players |
| `--data-dir <dir>` | `server/data` | Directory for the generated `host_ed25519` key |
| `SCRAP_PASSWORD` | _(none)_ | Shared password required for SSH login |

## Lobby & controls

- **`Enter` or `Space`** — toggle ready / not ready
- **`q` or `Ctrl-C`** — disconnect from the lobby
- When every player in the lobby is ready, a 3-second countdown starts and all ready players launch together.
- Players who connect mid-race wait in the lobby with live standings and join the next race.
- In-game **`Ctrl-C`** forfeits the run and returns to the lobby. Reaching the Surface or being destroyed shows the normal end screen; pressing any key from it returns to the lobby.

## How races & ranking work

Every racer runs their own copy of SCRAPCORE with the same seed: identical starting parts, floor layouts, robots, and loot on every depth (Depth 10 up to Depth 1 and the Surface). Row 31 beneath the game shows a live `RIVALS` bar with each other racer's depth and core HP (or `SURFACED`, `X`, or `OUT`).

Standings rank racers in order:

1. Reached the Surface first (earliest finish wins)
2. Shallowest depth reached
3. Still racing (beats eliminated/forfeited players at the same depth)
4. More kills
5. Fewer turns

## Isolation (what guests can and cannot do)

This server is its own SSH implementation using `ssh2`, not a system login shell:

- **Allowed:** lobby input and keystrokes sent to the player's emulated SCRAPCORE instance.
- **Denied:** no OS shell, `exec`, `sftp`, X11, agent forwarding, or TCP/local port forwarding. All non-game SSH requests are rejected.

## Tests

```bash
cd server && npm test
```
