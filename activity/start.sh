#!/bin/sh
# Virtual screen and sound card for the cloud browser, then the server.
set -e
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1280x720x24 -nolisten tcp &
pulseaudio --daemonize --exit-idle-time=-1 --log-target=stderr
pactl load-module module-null-sink sink_name=out >/dev/null
pactl set-default-sink out
exec bun activity/server.ts
