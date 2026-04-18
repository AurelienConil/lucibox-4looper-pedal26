#!/bin/bash
jack_wait -w
exec chrt -f 70 pd -nogui -jack _main.pd

