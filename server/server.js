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

function parseArgs(argv) {
  const o = { port: 2222, host: '0.0.0.0', maxPlayers: 8, password: process.env.SCRAP_PASSWORD || '', dataDir: path.join(__dirname, 'data') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--port') { o.port = parseInt(v, 10); i++; }
    else if (a === '--host') { o.host = v; i++; }
    else if (a === '--max-players') { o.maxPlayers = parseInt(v, 10); i++; }
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
  const room = new Room({ build: game, maxPlayers: opts.maxPlayers, countdownMs: opts.countdownMs, seed: opts.seed });
  const server = new Server({ hostKeys: [opts.hostKey || hostKey(opts.dataDir)] }, client => {
    let user = 'robot';
    client.on('authentication', ctx => {
      user = ctx.username;
      if (!opts.password) return ctx.accept();
      if (ctx.method === 'password' && samePassword(ctx.password, opts.password)) return ctx.accept();
      if (ctx.method === 'keyboard-interactive') {
        return ctx.prompt([{ prompt: 'Password: ', echo: false }], answers => {
          if (answers && samePassword(answers[0] || '', opts.password)) ctx.accept(); else ctx.reject();
        });
      }
      return ctx.reject(['password', 'keyboard-interactive']);
    });
    client.on('ready', () => {
      client.on('session', accept => {
        const session = accept();
        const term = { rows: 24, cols: 80, term: 'xterm-256color' };
        let member = null;
        session.on('pty', (acc, _rej, info) => {
          term.rows = info.rows || 24; term.cols = info.cols || 80; term.term = info.term || term.term;
          acc && acc();
        });
        session.on('window-change', (acc, _rej, info) => {
          term.rows = info.rows || term.rows; term.cols = info.cols || term.cols;
          acc && acc();
          if (member) room.resize(member, term.rows, term.cols);
        });
        session.on('shell', acc => {
          const stream = acc();
          if (member || room.isFull()) { stream.write(T.full); stream.exit(0); stream.end(); return; }
          const conn = {
            name: user, rows: term.rows, cols: term.cols,
            colorMode: display.detectColorMode({ TERM: term.term }),
            write: s => { if (s && stream.writable) stream.write(s); },
            close: () => { try { stream.write(T.bye); stream.exit(0); stream.end(); } catch (_) { /* gone */ } },
          };
          member = room.join(conn);
          console.log(`[versus] ${member.name} joined (${room.members.length} online)`);
          stream.on('data', d => room.input(member, d));
          stream.on('close', () => { room.leave(member); });
        });
        // exec, subsystem (sftp), env, x11, agent forwarding: no handler, so ssh2 rejects them.
      });
      // tcpip / streamlocal channels and global forwarding requests: no handler, rejected.
    });
    client.on('close', () => { /* channel close already left the room */ });
    client.on('error', e => { if (opts.verbose) console.error('[versus] client error:', e.message); });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.removeListener('error', reject);
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
