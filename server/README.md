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

When `SCRAP_PASSWORD` is set, an SSH key does **not** bypass the password: your SSH client presents its key first (to establish your ranked identity) and then prompts for the shared password.

## Options

| Flag / Env | Default | Description |
|---|---|---|
| `--port <n>` | `2222` | TCP port to listen on |
| `--host <addr>` | `0.0.0.0` | Address to bind |
| `--max-players <n>` | `8` | Maximum concurrent players |
| `--data-dir <dir>` | `server/data` | Directory for the SSH host key (`host_ed25519`), player profiles (`profiles.json`), and daily boards (`daily/`) |
| `SCRAP_PASSWORD` | _(none)_ | Shared password required for SSH login |

## Lobby & controls

- **`Enter` or `Space`** — toggle ready / not ready
- **`d`** — toggle the next race (room-wide, for everyone) between today's shared daily seed and a random seed (restarts an active countdown so everyone sees the change)
- **`Tab`** — cycle your own view: lobby → daily board & your record → last-race chronicle → lobby
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

After a race finishes, press **`Tab`** twice from the lobby to view the **last-race chronicle**: each racer's floor splits, final loadout, cause of destruction, and salvaged/lost/recycled part counts (kept in memory until the next race or server restart).

## Daily seed, profiles & guest play

- **Daily seed**: Derived from a hash of the UTC date (`YYYY-MM-DD`), so every server shares the same daily seed all day. Press **`d`** in the lobby to switch the room to the daily seed before starting.
- **Daily board**: Keeps each ranked player's **best** run of the day (repeat attempts are allowed). Entries are ordered by:
  1. Reached the Surface first (fastest time)
  2. Shallowest depth reached
  3. Runs that ended in play (destroyed) over forfeits (`Ctrl-C`), disconnects, and crashes at the same depth — so a later instant forfeit never replaces a real run
  4. Faster time
  5. Fewer turns
  Boards are scoped per game build, so a new build starts a fresh board.
- **Ranked play (SSH key)**: Running `ssh -p 2222 <name>@<host>` offers your default SSH key automatically if you have one. After verifying your key's signature, the server tracks your persistent record across all races (total races, best depth, wins, and fastest win — both requiring 1st place on the Surface) and ranks your daily-seed runs on the daily board. If one key is connected in multiple seats of the same race, its profile counts the race once (its better-placed run) and the daily board keeps its better run by board order. Keys the server cannot read (e.g. FIDO/security keys `sk-*` or OpenSSH certificates) are skipped, so those players still connect — as guests unless they also have a regular key.
- **Guest play (no key)**: Players without an SSH key — or anyone opting out with `ssh -p 2222 -o PubkeyAuthentication=no <name>@<host>` — join and race normally (including on the daily seed), but are never saved to a profile or the daily board. To let SSH clients offer their keys, the server does not accept SSH `none` auth and instead admits keyless guests via `keyboard-interactive` auth with no prompt (or the password prompt when `SCRAP_PASSWORD` is set). Normal interactive `ssh` handles this transparently, but a keyless `ssh -o BatchMode=yes` (which disables `keyboard-interactive`) — or any client without `keyboard-interactive` support — is refused.

## Saved data & privacy

Everything persisted lives under `--data-dir` (default `server/data`), written atomically via temp file + rename:

- `host_ed25519` — SSH server host key
- `profiles.json` — player records keyed by SSH public-key fingerprint
- `daily/<date>_<buildId>_<seed>.json` — daily leaderboards

**Privacy:** Only SSH public-key fingerprints (`SHA256:...`) and display handles are stored — never SSH keys themselves, passwords, or IP addresses.

## Isolation (what guests can and cannot do)

This server is its own SSH implementation using `ssh2`, not a system login shell:

- **Allowed:** lobby input and keystrokes sent to the player's emulated SCRAPCORE instance.
- **Denied:** no OS shell, `exec`, `sftp`, X11, agent forwarding, or TCP/local port forwarding. All non-game SSH requests are rejected.

## Tests

```bash
cd server && npm test
```
