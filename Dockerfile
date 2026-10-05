FROM oven/bun:1-debian
RUN apt-get update && apt-get install -y --no-install-recommends xvfb pulseaudio ffmpeg fonts-noto-color-emoji curl ca-certificates unzip \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
# Chromium plus its system libraries, from the same Playwright version the server uses.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN bunx playwright-core install --with-deps chromium && rm -rf /var/lib/apt/lists/*
# uBlock Origin Lite blocks the ads and the cookie banners that a fresh profile shows.
# Its cookie and overlay lists are off by default; turn them on. Chromium writes the
# indexed rulesets into the folder, so the bun user must own it.
ARG UBOL=2026.930.1227
ENV UBOL_DIR=/opt/ubol
RUN curl -fsSL -o /tmp/ubol.zip https://github.com/uBlockOrigin/uBOL-home/releases/download/$UBOL/uBOLite_$UBOL.chromium.zip \
  && unzip -q /tmp/ubol.zip -d $UBOL_DIR && rm /tmp/ubol.zip \
  && bun -e 'const f = process.env.UBOL_DIR + "/rulesets/ruleset-details.json"; const r = await Bun.file(f).json(); for (const x of r) if (["annoyances-cookies", "annoyances-overlays"].includes(x.id)) x.enabled = true; await Bun.write(f, JSON.stringify(r));' \
  && chown -R bun:bun $UBOL_DIR
COPY . .
RUN bun run activity:build && mkdir -p /data /tmp/.X11-unix && chown bun:bun /data && chmod 1777 /tmp/.X11-unix
USER bun
ENV DISPLAY=:99 PROFILE_DIR=/data/profile
CMD ["sh", "activity/start.sh"]
