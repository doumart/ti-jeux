#!/bin/sh
# Runs at boot from cron. EC2 gives a new public IP on every start, so point DOMAIN at it.
cd "$(dirname "$0")/.." || exit 1
get() { sed -n "s/^$1=//p" .env | tr -d '\r '; }
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  curl -fsS "https://www.duckdns.org/update?domains=$(get DOMAIN | cut -d. -f1)&token=$(get DUCKDNS_TOKEN)" | grep -q OK && exit 0
  sleep 5
done
echo 'DuckDNS update failed. Check DOMAIN and DUCKDNS_TOKEN in .env.' >&2
exit 1
