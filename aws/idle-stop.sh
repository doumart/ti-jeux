#!/bin/sh
# Runs every minute from cron. Stops the instance after 5 minutes with no HTTPS
# connection and no Session Manager shell. The counter lives in /run, so each boot starts at 0.
f=/run/tijeux-idle
if ss -Htn state established '( sport = :443 )' | grep -q . || pgrep -f ssm-session-worker >/dev/null; then echo 0 > $f; exit 0; fi
n=$(( $(cat $f 2>/dev/null || echo 0) + 1 ))
echo $n > $f
[ $n -lt 5 ] || shutdown -h now
