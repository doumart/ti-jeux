# ti-jeux

Chrome extension that rotates through daily web games, plus a Discord Activity
("ti-jeux together") where a voice channel plays them together.

## Extension

`chrome://extensions` → Developer mode → **Load unpacked** → this folder.

## Discord Activity

The games run in a **cloud browser**: a real Chromium on your server with this
extension loaded (navbar, next-game chooser, completion tracking, ad skipping all
work). Its screen and sound stream into the Activity. The person who launches the
Activity plays by clicking and typing on the stream; everyone who joins watches.
Nobody needs Chrome.

Only the app's owner (or team, or `HOSTS`) can drive, because the browser holds
your game logins. One Activity uses the browser at a time.

### Try it locally

```bash
bun install
bun run activity:dev          # builds the Docker image, then http://localhost:3000
```

**Create preview session** to drive; open the viewer link in another tab.

### Deploy (free, Oracle Cloud)

The cloud browser needs ~2 GB RAM, so it won't fit free web hosts. Oracle's Always
Free tier has an Arm VM that does.

1. **Oracle Cloud** → create a VM: Ubuntu, shape *VM.Standard.A1.Flex*
   (Always Free, e.g. 2 OCPU / 12 GB). If it says "out of capacity", try another
   availability domain or later.
   In its VCN's *Security List*, add ingress rules for TCP **80** and **443** from `0.0.0.0/0`.
2. **Free domain**: at [duckdns.org](https://www.duckdns.org) create e.g.
   `ti-jeux.duckdns.org` pointing to the VM's public IP.
3. **On the VM**:
   ```bash
   git clone -b feat/discord-activity https://github.com/doumart/ti-jeux.git && cd ti-jeux
   ./deploy-oracle.sh      # installs Docker, opens the firewall, creates .env
   nano .env               # Discord values + DOMAIN / PUBLIC_ORIGIN
   sudo docker compose up -d --build
   ```
   Caddy gets the HTTPS certificate automatically. Check `https://<domain>/health`.
4. **Discord Developer Portal** → your app:
   - *Activities → Settings*: enable Activities (Desktop).
   - *Activities → URL Mappings*: `/` → `<domain>`.
   - *OAuth2 → Redirects*: `https://127.0.0.1`.
   - *General Information → Interactions Endpoint URL*: `https://<domain>/api/interactions`.
5. `bun run activity:register` (with `DISCORD_CLIENT_ID` and `DISCORD_BOT_TOKEN` set).
6. In a voice channel: 🚀 Activities → ti-jeux.

Updating: `git pull && sudo docker compose up -d --build`.

### Deploy (AWS, off when not playing)

About US$1.50 a month for 15 minutes a day. The EC2 instance stays stopped. A Lambda
receives Discord's launch request: it starts the instance if it's stopped, and forwards
the request once it's running. The instance stops itself after 5 idle minutes.

1. **Free domain**: create one at [duckdns.org](https://www.duckdns.org).
2. **Stack** (from your laptop, AWS CLI signed in, [Pulumi](https://www.pulumi.com/docs/install/) installed):
   ```bash
   cd aws && bun install
   pulumi stack init nexapp
   pulumi config set domain ti-jeux.duckdns.org
   pulumi config set --secret discordPublicKey <DISCORD_PUBLIC_KEY>
   AWS_PROFILE=<profile> pulumi up
   ```
   It prints `interactionsEndpointUrl` and `instanceId`. The region is `ca-central-1` (`aws/Pulumi.yaml`).
3. **On the instance**: AWS console → EC2 → ti-jeux → *Connect* → *Session Manager*.
   An open session keeps the instance up.
   ```bash
   cd /opt/ti-jeux && sudo nano .env   # Discord values, DOMAIN, PUBLIC_ORIGIN, DUCKDNS_TOKEN
   sudo aws/duckdns.sh && sudo docker compose up -d --build
   ```
   Check `https://<domain>/health`. Then do step 4 and 5 of the Oracle section, but use
   `interactionsEndpointUrl` as the *Interactions Endpoint URL*.
4. **Play**: the first launch of the day answers "Waking up the server". Launch again
   after about a minute.

Updating: open a session, then `cd /opt/ti-jeux && sudo git pull && sudo docker compose up -d --build`.
Infrastructure changes: `cd aws && pulumi up`.

### Tests

```bash
bun test                # Discord auth, host-only control, room isolation (fake browser)
bun run test:cloud      # against a running `activity:dev`: real video, audio, game status, input
```
