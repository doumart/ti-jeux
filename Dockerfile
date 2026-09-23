FROM oven/bun:1-debian
RUN apt-get update && apt-get install -y --no-install-recommends xvfb pulseaudio ffmpeg fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
# Chromium plus its system libraries, from the same Playwright version the server uses.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN bunx playwright-core install --with-deps chromium && rm -rf /var/lib/apt/lists/*
COPY . .
RUN bun run activity:build && mkdir -p /data /tmp/.X11-unix && chown bun:bun /data && chmod 1777 /tmp/.X11-unix
USER bun
ENV DISPLAY=:99 PROFILE_DIR=/data/profile
CMD ["sh", "activity/start.sh"]
