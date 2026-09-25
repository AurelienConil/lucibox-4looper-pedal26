#!/bin/bash

until ip link show lo | grep -q "UP"; do
  echo "Waiting for loopback interface to be UP..."
  sleep 1
done

echo "Loopback interface is UP."


exec node /home/patch/lucibox/node/main.js
