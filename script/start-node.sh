#!/bin/bash

until ip link show lo | grep -q "UP"; do
  echo "Waiting for loopback interface to be UP..."
  sleep 1
done

echo "Loopback interface is UP."

export NVM_DIR="$HOME/.nvm"
# Charge nvm si ce n'est pas déjà fait
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

nvm use --lts
exec node /home/patch/lucibox/node/main.js