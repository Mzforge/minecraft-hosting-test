/* ==========================================================================
   MZForge — app.js
   Shared across every page. Load with <script src="app.js"></script>.

   Sections
     1. helpers            5. Modrinth
     2. theme + scrollbar  6. server.properties (build + parse)
     3. Auth               7. launchers + README
     4. ServerState        8. Pack (ZIP) generator
   ========================================================================== */

/* ---------- 1. helpers ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

const clampInt = (n, min, max, fallback) => {
  const x = parseInt(n, 10);
  if (Number.isNaN(x)) return fallback;
  return Math.min(max, Math.max(min, x));
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );

function toast(msg, ms = 2200) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

function copyText(text, btn) {
  const done = () => {
    if (!btn) return toast('Copied');
    const old = btn.textContent;
    btn.textContent = 'Copied';
    btn.classList.add('done');
    setTimeout(() => {
      btn.textContent = old;
      btn.classList.remove('done');
    }, 1100);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => toast('Copy failed'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch { toast('Copy failed'); }
    ta.remove();
  }
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- 2. theme + custom scrollbar ---------- */
const Theme = {
  init() {
    const saved = localStorage.getItem('mz_theme') || 'night';
    document.documentElement.setAttribute('data-theme', saved);
    const btn = $('#themeToggle');
    if (!btn) return;
    const label = $('#themeLabel');
    const paint = () => {
      const t = document.documentElement.getAttribute('data-theme');
      if (label) label.textContent = t === 'night' ? 'Night' : 'Day';
    };
    paint();
    btn.addEventListener('click', () => {
      const next =
        document.documentElement.getAttribute('data-theme') === 'day' ? 'night' : 'day';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('mz_theme', next);
      paint();
    });
  },
};

const Scrollbar = {
  init() {
    if ($('#sbTrack')) return;
    const track = document.createElement('div');
    track.id = 'sbTrack';
    track.innerHTML = '<div id="sbThumb"></div>';
    document.body.appendChild(track);

    const thumb = $('#sbThumb', track);
    let dragging = false, startY = 0, startScroll = 0, hideT = null;
    const doc = () => document.documentElement;
    const maxScroll = () => doc().scrollHeight - window.innerHeight;

    function show() {
      track.classList.add('on');
      clearTimeout(hideT);
      hideT = setTimeout(() => { if (!dragging) track.classList.remove('on'); }, 1400);
    }
    function update() {
      const ms = maxScroll();
      if (ms <= 4) { track.classList.remove('on'); return; }
      const trackH = track.clientHeight;
      const thumbH = Math.max(48, trackH * (window.innerHeight / doc().scrollHeight));
      thumb.style.height = thumbH + 'px';
      thumb.style.transform = `translateY(${(window.scrollY / ms) * (trackH - thumbH)}px)`;
      show();
    }
    thumb.addEventListener('mousedown', (e) => {
      dragging = true; startY = e.clientY; startScroll = window.scrollY;
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const trackH = track.clientHeight, thumbH = thumb.offsetHeight;
      window.scrollTo(0, startScroll + (e.clientY - startY) * (maxScroll() / (trackH - thumbH)));
    });
    window.addEventListener('mouseup', () => {
      dragging = false; document.body.style.userSelect = '';
    });
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    setInterval(update, 900);
    update();
  },
};

/* ---------- 3. Auth ----------
   Mock backend on localStorage. Every method is async and returns
   { ok, error? } so swapping in a real API is a one-line change per method:
     const res = await fetch('/api/auth/login', {...}); return res.json();
------------------------------------------------------------------------- */
const Auth = {
  KEY_USERS: 'mz_users',
  KEY_SESSION: 'mz_session',

  _users() {
    try { return JSON.parse(localStorage.getItem(this.KEY_USERS) || '[]'); }
    catch { return []; }
  },
  _saveUsers(u) { localStorage.setItem(this.KEY_USERS, JSON.stringify(u)); },

  /** Demo-only digest. A real backend must use argon2/bcrypt server-side. */
  async _hash(pw) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw + '::mzforge'));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  },

  current() {
    try { return JSON.parse(localStorage.getItem(this.KEY_SESSION) || 'null'); }
    catch { return null; }
  },
  isSignedIn() { return Boolean(this.current()); },

  async register({ username, email, password }) {
    email = String(email || '').trim().toLowerCase();
    username = String(username || '').trim();

    if (username.length < 3 || username.length > 20)
      return { ok: false, field: 'username', error: 'Usernames are 3–20 characters.' };
    if (!/^[a-zA-Z0-9_]+$/.test(username))
      return { ok: false, field: 'username', error: 'Use letters, numbers and underscores only.' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return { ok: false, field: 'email', error: 'Enter a valid email address.' };
    if (String(password).length < 8)
      return { ok: false, field: 'password', error: 'Use at least 8 characters.' };

    const users = this._users();
    if (users.some((u) => u.email === email))
      return { ok: false, field: 'email', error: 'That email already has an account.' };
    if (users.some((u) => u.username.toLowerCase() === username.toLowerCase()))
      return { ok: false, field: 'username', error: 'That username is taken.' };

    users.push({ username, email, hash: await this._hash(password), at: Date.now() });
    this._saveUsers(users);
    localStorage.setItem(this.KEY_SESSION, JSON.stringify({ username, email }));
    return { ok: true };
  },

  async login({ email, password }) {
    email = String(email || '').trim().toLowerCase();
    const user = this._users().find((u) => u.email === email);
    const fail = { ok: false, field: 'password', error: 'That email and password do not match an account.' };
    if (!user) return fail;
    if (user.hash !== (await this._hash(password))) return fail;
    localStorage.setItem(this.KEY_SESSION, JSON.stringify({ username: user.username, email: user.email }));
    return { ok: true };
  },

  /** OAuth placeholder. Real flow: redirect to /api/auth/signin/<provider>. */
  async oauth(provider) {
    const username = provider === 'discord' ? 'DiscordUser' : 'GoogleUser';
    localStorage.setItem(this.KEY_SESSION, JSON.stringify({
      username, email: `${username.toLowerCase()}@example.com`, provider,
    }));
    return { ok: true };
  },

  signOut() {
    localStorage.removeItem(this.KEY_SESSION);
    location.href = 'index.html';
  },

  /** Bounce guests away from the panel, and signed-in users away from auth pages. */
  guard(kind) {
    const signedIn = this.isSignedIn();
    if (kind === 'protected' && !signedIn) {
      const next = encodeURIComponent(location.pathname.split('/').pop() + location.search);
      location.replace(`login.html?next=${next}`);
      return false;
    }
    if (kind === 'guest' && signedIn) {
      location.replace('dashboard.html');
      return false;
    }
    return true;
  },
};

/* ---------- 4. ServerState ---------- */
const SWNAME = { paper: 'Paper', vanilla: 'Vanilla', fabric: 'Fabric', neoforge: 'NeoForge' };

const MC_COLORS = {
  '0': '#000000', '1': '#0000aa', '2': '#00aa00', '3': '#00aaaa',
  '4': '#aa0000', '5': '#aa00aa', '6': '#ffaa00', '7': '#aaaaaa',
  '8': '#555555', '9': '#5555ff', a: '#55ff55', b: '#55ffff',
  c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: '#ffffff',
};

const DEFAULTS = {
  name: 'my-server',
  sw: 'paper',
  mcver: '26.1.2',
  ram: 4,
  maxPlayers: 10,
  port: 25565,
  gamemode: 'survival',
  difficulty: 'normal',
  whitelist: 'false',
  onlineMode: 'true',
  pvp: 'true',
  viewDistance: 10,
  motd: '§aMy Server',
  motd2: 'Come and build with us',
  icon: null,
  iconURL: null,
  addons: {},
  bundlePlayit: true,
};

const ServerState = {
  KEY: 'mz_server',
  data: { ...DEFAULTS },
  _subs: [],

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      if (saved) this.data = { ...DEFAULTS, ...saved, icon: null };
    } catch { /* keep defaults */ }
    return this.data;
  },
  save() {
    const { icon, ...rest } = this.data;   // Uint8Array can't be JSON'd
    localStorage.setItem(this.KEY, JSON.stringify(rest));
  },
  set(patch) {
    Object.assign(this.data, patch);
    this.save();
    this._subs.forEach((fn) => fn(this.data));
  },
  onChange(fn) { this._subs.push(fn); fn(this.data); },

  selectedAddons() {
    return Object.keys(this.data.addons).filter((k) => this.data.addons[k]?.on);
  },
};

/** Renders §-codes to HTML. Handles colour, bold, italic, underline, reset. */
function renderMotd(raw) {
  const text = String(raw || '').replace(/\u00C2\u00A7/g, '\u00A7');
  let html = '';
  let open = 0;
  let style = { color: null, bold: false, italic: false, under: false };

  const openSpan = () => {
    const css = [];
    if (style.color) css.push(`color:${style.color}`);
    if (style.bold) css.push('font-weight:700');
    if (style.italic) css.push('font-style:italic');
    if (style.under) css.push('text-decoration:underline');
    html += `<span style="${css.join(';')}">`;
    open++;
  };
  const closeAll = () => { while (open > 0) { html += '</span>'; open--; } };

  openSpan();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\u00A7' && i + 1 < text.length) {
      const code = text[++i].toLowerCase();
      if (MC_COLORS[code]) { style = { color: MC_COLORS[code], bold: false, italic: false, under: false }; }
      else if (code === 'l') style.bold = true;
      else if (code === 'o') style.italic = true;
      else if (code === 'n') style.under = true;
      else if (code === 'r') style = { color: null, bold: false, italic: false, under: false };
      closeAll();
      openSpan();
      continue;
    }
    html += esc(ch);
  }
  closeAll();
  return html;
}

/* ---------- 5. Modrinth ---------- */
const CATALOG = {
  paper: [
    { slug: 'viaversion', name: 'ViaVersion', desc: 'Let players on other versions join.', on: true },
    { slug: 'essentialsx', name: 'EssentialsX', desc: '/home, /tpa, /warp, /kit and more.', on: true },
    { slug: 'luckperms', name: 'LuckPerms', desc: 'Ranks and permissions.' },
    { slug: 'worldedit', name: 'WorldEdit', desc: 'Build and edit huge areas fast.' },
    { slug: 'coreprotect', name: 'CoreProtect', desc: 'Log and roll back griefing.' },
    { slug: 'chunky', name: 'Chunky', desc: 'Pre-generate the world to cut lag.' },
    { slug: 'spark', name: 'spark', desc: 'Find what is causing lag.' },
    { slug: 'geyser', name: 'Geyser', desc: 'Let Bedrock players join.' },
  ],
  fabric: [
    { slug: 'fabric-api', name: 'Fabric API', desc: 'Required by most Fabric mods.', on: true },
    { slug: 'lithium', name: 'Lithium', desc: 'Big performance boost.', on: true },
    { slug: 'ferrite-core', name: 'FerriteCore', desc: 'Uses less memory.' },
    { slug: 'spark', name: 'spark', desc: 'Find lag sources.' },
    { slug: 'chunky', name: 'Chunky', desc: 'Pre-generate the world.' },
  ],
  neoforge: [
    { slug: 'ferrite-core', name: 'FerriteCore', desc: 'Uses less memory.', on: true },
    { slug: 'spark', name: 'spark', desc: 'Find lag sources.' },
    { slug: 'chunky', name: 'Chunky', desc: 'Pre-generate the world.' },
  ],
  vanilla: [],
};

const Modrinth = {
  API: 'https://api.modrinth.com/v2',

  loaders(sw) {
    if (sw === 'paper') return ['paper', 'spigot', 'bukkit', 'purpur', 'folia'];
    if (sw === 'fabric') return ['fabric'];
    if (sw === 'neoforge') return ['neoforge', 'forge'];
    return [];
  },

  async search(query, sw) {
    const facets = JSON.stringify([this.loaders(sw).map((l) => `categories:${l}`)]);
    const url = `${this.API}/search?limit=15&index=relevance&query=${encodeURIComponent(query)}&facets=${encodeURIComponent(facets)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Modrinth search failed (${res.status})`);
    return (await res.json()).hits || [];
  },

  /** Newest compatible file for a project, or null when there's no build. */
  async resolveFile(slug, mcver, sw) {
    const loaders = JSON.stringify(this.loaders(sw));
    const games = JSON.stringify([mcver]);
    const url = `${this.API}/project/${encodeURIComponent(slug)}/version?game_versions=${encodeURIComponent(games)}&loaders=${encodeURIComponent(loaders)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const versions = await res.json();
    if (!versions.length) return null;
    const file = versions[0].files.find((f) => f.primary) || versions[0].files[0];
    return file ? { url: file.url, filename: file.filename } : null;
  },
};

/* ---------- 6. server.properties ---------- */
const Properties = {
  build(s) {
    const motd = s.motd + (s.motd2 ? `\\n${s.motd2}` : '');
    return [
      '#Minecraft server properties (generated by MZForge)',
      `#${new Date().toUTCString()}`,
      `server-port=${clampInt(s.port, 1, 65535, 25565)}`,
      `motd=${motd}`,
      `max-players=${clampInt(s.maxPlayers, 1, 500, 10)}`,
      `gamemode=${s.gamemode}`,
      `difficulty=${s.difficulty}`,
      `online-mode=${s.onlineMode}`,
      `white-list=${s.whitelist}`,
      `enforce-whitelist=${s.whitelist}`,
      `pvp=${s.pvp}`,
      `view-distance=${clampInt(s.viewDistance, 2, 32, 10)}`,
      'simulation-distance=8',
      'spawn-protection=0',
      'enable-command-block=false',
      'level-name=world',
      'enable-rcon=false',
    ].join('\n') + '\n';
  },

  /** Parse an uploaded file, preserving comments and key order for round-trips. */
  parse(text) {
    const order = [];
    const map = {};
    text.split(/\r?\n/).forEach((line) => {
      if (/^\s*#/.test(line) || !line.includes('=')) { order.push({ raw: line }); return; }
      const i = line.indexOf('=');
      const key = line.slice(0, i);
      map[key] = line.slice(i + 1);
      order.push({ key });
    });
    return { map, order };
  },

  /** Rebuild the original file with new values, leaving untouched lines intact. */
  serialize({ map, order }, updates = {}) {
    Object.assign(map, updates);
    const seen = new Set();
    const out = order.map((o) => {
      if (o.raw !== undefined) return o.raw;
      seen.add(o.key);
      return `${o.key}=${map[o.key]}`;
    });
    Object.keys(updates).forEach((k) => {
      if (!seen.has(k)) out.push(`${k}=${updates[k]}`);
    });
    return out.join('\n') + '\n';
  },

  /** Split a raw motd value into colour-stripped text + detected styles. */
  readMotd(raw) {
    const norm = String(raw || '').replace(/\u00C2\u00A7/g, '\u00A7').replace(/\uFFFD/g, '\u00A7');
    const colour = (norm.match(/\u00A7([0-9a-f])/i) || [])[1] || '';
    return {
      colour: colour ? `\u00A7${colour.toLowerCase()}` : '',
      bold: /\u00A7l/i.test(norm),
      italic: /\u00A7o/i.test(norm),
      text: norm.replace(/\u00A7[0-9a-fk-or]/gi, '').replace(/\\n[\s\S]*$/, ''),
    };
  },
};

/* ---------- 7. launchers ---------- */
const Launchers = {
  bat(s) {
    const playit = s.bundlePlayit;
    return [
      '@echo off',
      `title ${s.name || 'Minecraft Server'}`,
      'cd /d "%~dp0"',
      '',
      'REM --- find the server jar (any name works) ---',
      'set "JAR="',
      'for %%f in (*.jar) do set "JAR=%%f"',
      'if not defined JAR (',
      '  echo No server .jar found in this folder.',
      '  echo Run  get-server.bat  first, or drop a server jar here.',
      '  echo. & pause & exit /b',
      ')',
      '',
      'REM --- Java check ---',
      'java -version >nul 2>&1',
      'if errorlevel 1 (',
      '  echo Java was not found.',
      `  echo Minecraft ${s.mcver} needs Java ${/^2[6-9]\./.test(s.mcver) ? '25' : '21'}. Get it free from adoptium.net`,
      '  echo. & pause & exit /b',
      ')',
      '',
      ...(playit ? [
        'REM --- public address tunnel, started quietly in the background ---',
        'if exist playit.exe (',
        '  tasklist /FI "IMAGENAME eq playit.exe" 2>nul | find /I "playit.exe" >nul',
        '  if errorlevel 1 (',
        '    echo Starting your public address ^(playit.gg^)...',
        '    echo First run only: a claim link appears at playit.gg - open it once and click Allow.',
        '    start /B playit.exe',
        '  ) else (',
        '    echo playit is already running.',
        '  )',
        ')',
        '',
      ] : []),
      `echo Starting %JAR% with ${s.ram}GB RAM...`,
      `java -Xms${s.ram}G -Xmx${s.ram}G -jar "%JAR%" nogui`,
      '',
      'echo.',
      'echo Server stopped. Press any key to close.',
      'pause >nul',
    ].join('\r\n') + '\r\n';
  },

  sh(s) {
    const playit = s.bundlePlayit;
    return [
      '#!/bin/bash',
      'cd "$(dirname "$0")"',
      '',
      'JAR=$(ls *.jar 2>/dev/null | head -n1)',
      'if [ -z "$JAR" ]; then',
      '  echo "No server .jar found. Run get-server.sh first, or drop one here."',
      '  read -n1 -r -p "Press any key to close..."; exit 1',
      'fi',
      '',
      'if ! command -v java >/dev/null 2>&1; then',
      `  echo "Java was not found. Minecraft ${s.mcver} needs Java ${/^2[6-9]\./.test(s.mcver) ? '25' : '21'} - see adoptium.net"`,
      '  read -n1 -r -p "Press any key to close..."; exit 1',
      'fi',
      '',
      ...(playit ? [
        '# public address tunnel',
        'if [ -f ./playit ]; then',
        '  chmod +x ./playit',
        '  if ! pgrep -x playit >/dev/null 2>&1; then',
        '    echo "Starting your public address (playit.gg)..."',
        '    echo "First run only: a claim link appears below - open it once and click Allow."',
        '    ./playit &',
        '  fi',
        'fi',
        '',
      ] : []),
      `echo "Starting $JAR with ${s.ram}GB RAM..."`,
      `java -Xms${s.ram}G -Xmx${s.ram}G -jar "$JAR" nogui`,
    ].join('\n') + '\n';
  },

  /** Fallback fetcher when the browser couldn't embed the jar itself. */
  getServerBat(s) {
    const lines = ['@echo off', 'title Get server file', 'cd /d "%~dp0"', ''];
    if (s.sw === 'paper') {
      lines.push(
        `echo Downloading Paper ${s.mcver}...`,
        `for /f "usebackq delims=" %%U in (\`powershell -NoProfile -ExecutionPolicy Bypass -Command "try{ (Invoke-RestMethod 'https://fill.papermc.io/v3/projects/paper/versions/${s.mcver}/builds/latest' -TimeoutSec 20).downloads.'server:default'.url } catch {}"\`) do (`,
        '  echo %%U| findstr /b "http" >nul && curl -4 -L --fail --connect-timeout 15 --speed-limit 1000 --speed-time 20 -m 300 -o server.jar "%%U"',
        ')'
      );
    } else if (s.sw === 'fabric') {
      lines.push(
        `echo Downloading Fabric for ${s.mcver}...`,
        'set "FLD=" & set "FINST="',
        `for /f "usebackq delims=" %%A in (\`powershell -NoProfile -Command "try{ (Invoke-RestMethod 'https://meta.fabricmc.net/v2/versions/loader/${s.mcver}' -TimeoutSec 20)[0].loader.version } catch {}"\`) do set "FLD=%%A"`,
        'for /f "usebackq delims=" %%B in (`powershell -NoProfile -Command "try{ (Invoke-RestMethod \'https://meta.fabricmc.net/v2/versions/installer\' -TimeoutSec 20)[0].version } catch {}"`) do set "FINST=%%B"',
        `if defined FLD if defined FINST curl -4 -L --fail -m 300 -o server.jar "https://meta.fabricmc.net/v2/versions/loader/${s.mcver}/%FLD%/%FINST%/server/jar"`
      );
    } else if (s.sw === 'neoforge') {
      lines.push(
        `echo Installing NeoForge for ${s.mcver}...`,
        'powershell -NoProfile -ExecutionPolicy Bypass -Command "try{ $all=(Invoke-RestMethod \'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge\' -TimeoutSec 20).versions; $v=($all | Where-Object {$_ -notlike \'*beta*\'} | Select-Object -Last 1); Invoke-WebRequest \\"https://maven.neoforged.net/releases/net/neoforged/neoforge/$v/neoforge-$v-installer.jar\\" -OutFile neoforge-installer.jar -TimeoutSec 120; java -jar neoforge-installer.jar --install-server } catch { Write-Host \'Install failed:\' $_.Exception.Message }"'
      );
    } else {
      lines.push(
        'echo Vanilla servers are downloaded from minecraft.net.',
        'start https://www.minecraft.net/en-us/download/server'
      );
    }
    lines.push('', 'echo. & echo Done. Now run start.bat', 'pause');
    return lines.join('\r\n') + '\r\n';
  },

  readme(s, notes) {
    const addons = ServerState.selectedAddons();
    const folder = s.sw === 'paper' ? 'plugins' : 'mods';
    return [
      `${s.name || 'Minecraft server'} — made with MZForge`,
      '='.repeat(46),
      '',
      'QUICK START',
      '1) Unzip this whole folder somewhere easy, like your Desktop.',
      notes.jarEmbedded
        ? '2) Open  start.bat  (Mac/Linux: start.sh). That is it.'
        : '2) Open  get-server.bat  once to fetch the server file, then open  start.bat.',
      '',
      'WHAT IS IN HERE',
      '- server.properties  — your settings, already filled in',
      '- eula.txt           — already accepted',
      notes.jarEmbedded ? '- server.jar         — the server itself' : '- get-server.bat     — downloads the server file',
      addons.length ? `- ${folder}/            — ${addons.length} add-on(s) already installed` : '',
      s.bundlePlayit && notes.playitEmbedded ? '- playit.exe         — gives your server a public address' : '',
      s.bundlePlayit && !notes.playitEmbedded ? '- playit.exe         — NOT included (see note below)' : '',
      '',
      `MEMORY: ${s.ram}GB. To change it, edit the numbers in start.bat.`,
      `JAVA:   Minecraft ${s.mcver} needs Java ${/^2[6-9]\./.test(s.mcver) ? '25' : '21'} — free at adoptium.net`,
      '',
      ...(s.bundlePlayit ? [
        'PLAYING WITH FRIENDS',
        '- start.bat launches playit quietly in the background.',
        '- FIRST RUN ONLY: a claim link like https://playit.gg/claim/xxxxx appears.',
        '  Open it once in your browser and click Allow. After that it is automatic.',
        '- Your public address is shown at playit.gg/account/tunnels.',
        '  Share it with friends: Multiplayer > Add Server > paste > Join.',
        '',
      ] : []),
      ...(notes.warnings.length ? ['NOTES', ...notes.warnings.map((w) => `- ${w}`), ''] : []),
      'Not affiliated with Mojang Studios or Microsoft.',
    ].filter(Boolean).join('\n') + '\n';
  },
};

/* ---------- 8. Pack (ZIP) generator ---------- */
const PLAYIT_URL =
  'https://github.com/playit-cloud/playit-agent/releases/latest/download/playit-windows-x86_64-signed.exe';

const Pack = {
  /**
   * Builds the ZIP in the browser.
   * Anything fetched cross-origin can be blocked by CORS or a slow network, so
   * every remote asset is attempted, then degraded gracefully: the pack always
   * downloads, and README + a fetcher script cover whatever couldn't be embedded.
   */
  async build(state, onProgress = () => {}) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip failed to load. Check your connection and retry.');

    const s = state;
    const zip = new JSZip();
    const notes = { jarEmbedded: false, playitEmbedded: false, warnings: [] };

    zip.file('eula.txt', '#Minecraft EULA accepted via MZForge\neula=true\n');
    zip.file('server.properties', Properties.build(s));
    if (s.icon) zip.file('server-icon.png', s.icon);

    /* add-ons ------------------------------------------------------------ */
    const slugs = ServerState.selectedAddons();
    const folder = s.sw === 'paper' ? 'plugins' : 'mods';
    let added = 0;

    for (let i = 0; i < slugs.length; i++) {
      const slug = slugs[i];
      onProgress(`Fetching ${slug} (${i + 1}/${slugs.length})…`);
      try {
        const file = await Modrinth.resolveFile(slug, s.mcver, s.sw);
        if (!file) { notes.warnings.push(`${slug}: no build for ${s.mcver}, skipped.`); continue; }
        const res = await fetch(file.url);
        if (!res.ok) throw new Error(res.status);
        zip.file(`${folder}/${file.filename}`, await res.arrayBuffer());
        added++;
      } catch {
        notes.warnings.push(`${slug}: could not be downloaded here — install it manually into /${folder}.`);
      }
    }
    if (slugs.length && added === 0) zip.folder(folder);

    /* playit -------------------------------------------------------------- */
    if (s.bundlePlayit) {
      onProgress('Adding playit.exe…');
      try {
        const res = await fetch(PLAYIT_URL);
        if (!res.ok) throw new Error(res.status);
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 500_000) throw new Error('short file');
        zip.file('playit.exe', buf);
        notes.playitEmbedded = true;
      } catch {
        notes.warnings.push(
          'playit.exe could not be bundled by the browser (blocked by CORS or the network). ' +
          'Download it from https://playit.gg/download, rename it to playit.exe and drop it in this folder — start.bat picks it up automatically.'
        );
      }
    }

    /* launchers + docs ---------------------------------------------------- */
    onProgress('Writing launchers…');
    zip.file('start.bat', Launchers.bat(s));
    zip.file('start.sh', Launchers.sh(s), { unixPermissions: '755' });
    if (!notes.jarEmbedded) zip.file('get-server.bat', Launchers.getServerBat(s));
    zip.file('README.txt', Launchers.readme(s, notes));

    onProgress('Compressing…');
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (meta) => onProgress(`Compressing… ${Math.round(meta.percent)}%`)
    );

    const safe = (s.name || 'minecraft').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '');
    return { blob, filename: `${safe || 'minecraft'}-server.zip`, notes, addonsAdded: added };
  },
};

/* ---------- boot ---------- */
document.documentElement.classList.add('js');
document.addEventListener('DOMContentLoaded', () => {
  Theme.init();
  Scrollbar.init();
  ServerState.load();
});
