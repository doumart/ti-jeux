# ti-jeux

Chrome extension that rotates through daily web games, plus a Discord Activity
("ti-jeux together") where friends in a voice channel watch the host play live.

## Extension

`chrome://extensions` → Developer mode → **Load unpacked** → this folder.

## Discord Activity

The host plays in Chrome. The extension captures the game tab (video + audio) and
relays it through `activity/server.ts` to everyone in the Activity. Viewers watch
and talk; only the person who launched the Activity can share.

### Try it locally (no Discord needed)

```bash
bun install
bun run activity:dev          # http://127.0.0.1:3000
```

Open it, **Create preview session** → **Get sharing link**. In Chrome, open a game,
click the extension → **Share to Discord**, paste the link, start sharing. Open the
viewer link in another tab to watch.

### Deploy

1. **Discord Developer Portal** → New Application.
   - *Activities → Settings*: enable Activities.
   - *Activities → URL Mappings*: `/` → your host (e.g. `<name>.onrender.com`).
   - *OAuth2*: add redirect `https://127.0.0.1`, copy client ID + secret.
   - *Bot*: reset token, copy it. *General Information*: copy the public key.
2. Host it on Render (free): push this repo to GitHub, then Render → **New →
   Blueprint** → pick the repo (it reads `render.yaml`). Fill in the five env vars;
   `PUBLIC_ORIGIN` is `https://<name>.onrender.com`. Use that host in the URL
   mapping and the steps below.
   Free instances sleep after ~15 min idle and take ~30 s to wake, longer than
   Discord waits for a launch. Open `/health` a minute before you play, or point a
   free uptime pinger at it every 5 min.
3. Portal → *General Information* → **Interactions Endpoint URL**:
   `https://<name>.onrender.com/api/interactions` (Discord pings it to verify).
4. `bun run activity:register` — makes the launch go through the server so it knows
   who the host is.
5. In a voice channel: Activities → ti-jeux. The launcher sees **Get sharing link**;
   paste it into the extension's Share page. Friends click **Join** on the Activity.

Desktop Discord is the target; mobile clients may not decode the stream.

### Tests

```bash
bun test                        # server auth, host authority, isolation
bun run test:activity-browser   # real tab capture → relay → playback (Chrome for Testing)
```
