#!/usr/bin/env node
'use strict';
// SCRAPCORE versus server. Guests connect with a plain `ssh -p <port> <name>@<host>`
// and get the lobby and the game, nothing else: there is no shell, exec, sftp or
// port forwarding behind this server, only keystrokes into the LCC+ emulator.
//
//   node server/server.js [--port 2222] [--host 0.0.0.0] [--max-players 8]
//   SCRAP_PASSWORD=secret node server/server.js      # require a shared password
//
// The host key is created on first run in server/data/ (keep it so returning
// guests are not warned that the host key changed).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server, utils } = require('ssh2');
const ROOT = path.resolve(__dirname, '..');
const { build, resolveTarget } = require(path.join(ROOT, 'tools/lib/assemble'));
const display = require(path.join(ROOT, 'tools/lib/display'));
const { Room } = require('./room');
const T = require('./text');

const ADMIT_MS = 30000;          // connect → in the lobby, or the connection is dropped
const MAX_AUTH_FAILS = 5;
const MAX_BUFFERED = 1 << 20;    // output queued for a guest who stopped reading: drop them
const MIN_PACKET = 1024;         // ssh2 1.17 spins on a 0 max packet size (mscdex/ssh2#1517)

function intArg(name, v, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} needs a whole number from ${min} to ${max}`);
  return n;
}

function parseArgs(argv) {
  const o = { port: 2222, host: '0.0.0.0', maxPlayers: 8, password: process.env.SCRAP_PASSWORD || '', dataDir: path.join(__dirname, 'data') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--port') { o.port = intArg(a, v, 0, 65535); i++; }
    else if (a === '--host') { o.host = v; i++; }
    else if (a === '--max-players') { o.maxPlayers = intArg(a, v, 1, 64); i++; }
    else if (a === '--data-dir') { o.dataDir = path.resolve(v); i++; }
    else if (a === '--help' || a === '-h') { o.help = true; }
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

function hostKey(dataDir) {
  const file = path.join(dataDir, 'host_ed25519');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const { private: priv } = utils.generateKeyPairSync('ed25519');
    fs.writeFileSync(file, priv, { mode: 0o600 });
  }
  return fs.readFileSync(file);
}

function buildGame() {
  const t = resolveTarget(path.join(ROOT, 'games/scrap'));
  return build(t.entry, { manifest: t.manifest, gameDir: t.gameDir });
}

function samePassword(given, want) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(want)).digest();
  return crypto.timingSafeEqual(a, b);
}

function startServer(opts) {
  const game = opts.build || buildGame();
  const room = new Room({ build: game, maxPlayers: opts.maxPlayers || 8, countdownMs: opts.countdownMs, endScreenMs: opts.endScreenMs, seed: opts.seed });
  const server = new Server({ hostKeys: [opts.hostKey || hostKey(opts.dataDir)], keepaliveInterval: 15000, keepaliveCountMax: 4 }, client => {
    let user = 'robot';
    let authFails = 0;
    let sessionTaken = false;
    let member = null;
    const admit = setTimeout(() => { if (!member) client.end(); }, ADMIT_MS);
    client.on('authentication', ctx => {
      user = ctx.username;
      if (!opts.password) return ctx.accept();
      const fail = () => {
        if (++authFails >= MAX_AUTH_FAILS) { client.end(); return; }
        ctx.reject(['password', 'keyboard-interactive']);
      };
      if (ctx.method === 'password') return samePassword(ctx.password, opts.password) ? ctx.accept() : fail();
      if (ctx.method === 'keyboard-interactive') {
        return ctx.prompt([{ prompt: 'Password: ', echo: false }], answers => {
          if (answers && samePassword(answers[0] || '', opts.password)) ctx.accept(); else fail();
        });
      }
      return ctx.reject(['password', 'keyboard-interactive']);   // 'none' probe: not a failure
    });
    client.on('ready', () => {
      client.on('session', (accept, reject) => {
        if (sessionTaken) return reject();          // one session (one seat) per connection
        sessionTaken = true;
        const session = accept();
        if (!(session._chanInfo.outgoing.packetSize >= MIN_PACKET)) { client.end(); return; }
        const term = { rows: 24, cols: 80, term: 'xterm-256color' };
        session.on('pty', (acc, _rej, info) => {
          term.rows = info.rows; term.cols = info.cols; term.term = String(info.term || term.term);
          acc && acc();
        });
        session.on('window-change', (acc, _rej, info) => {
          term.rows = info.rows; term.cols = info.cols;
          acc && acc();
          if (member) room.resize(member, term.rows, term.cols);
        });
        session.on('shell', acc => {
          const stream = acc && acc();
          if (!stream || member) return;
          if (room.isFull()) { stream.write(T.full); stream.exit(0); stream.end(); client.end(); return; }
          const conn = {
            name: user, rows: term.rows, cols: term.cols,
            colorMode: display.detectColorMode({ TERM: term.term }),
            write: str => {
              if (!str || !stream.writable) return;
              if (stream.writableLength > MAX_BUFFERED) { client.end(); return; }
              stream.write(str);
            },
            close: () => { try { stream.write(T.bye); stream.exit(0); stream.end(); } catch (_) { /* gone */ } },
          };
          stream.on('close', () => { if (member) room.leave(member); client.end(); });
          member = room.join(conn);
          clearTimeout(admit);
          console.log(`[versus] ${member.name} joined (${room.members.length} online)`);
          stream.on('data', d => room.input(member, d));
        });
        // exec, subsystem (sftp), env, x11, agent forwarding: no handler, so ssh2 rejects them.
      });
      // tcpip / streamlocal channels and global forwarding requests: no handler, rejected.
    });
    client.on('close', () => { clearTimeout(admit); if (member) room.leave(member); });
    client.on('error', e => { if (opts.verbose) console.error('[versus] client error:', e.message); });
  });
  server.maxConnections = Math.max(16, (opts.maxPlayers || 8) * 4);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.removeListener('error', reject);
      server.on('error', e => console.error(`[versus] server error: ${e.message}`));
      resolve({ server, room, port: server.address().port, close: () => { room.close(); server.close(); } });
    });
  });
}

if (require.main === module) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (opts.help) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 11).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  startServer(opts).then(({ port }) => {
    console.log(`[versus] SCRAPCORE versus listening on ${opts.host}:${port}${opts.password ? ' (password required)' : ''}`);
    console.log(`[versus] players join with: ssh -p ${port} <name>@<this machine>`);
  }).catch(e => { console.error(`[versus] ${e.message}`); process.exit(1); });
}

module.exports = { startServer, buildGame, parseArgs };
