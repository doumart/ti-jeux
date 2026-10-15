#!/bin/sh
# Run once on a fresh Oracle Cloud Ubuntu VM (Ampere A1, Always Free), from the repo folder.
set -e
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"
# Oracle's Ubuntu images drop inbound traffic in iptables, even when the VCN allows it.
sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT
sudo sh -c 'iptables-save > /etc/iptables/rules.v4'
[ -f .env ] || { cp .env.example .env; echo "Fill in .env, then run: sudo docker compose up -d --build"; exit 0; }
sudo docker compose up -d --build
