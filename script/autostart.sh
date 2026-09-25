#!/bin/bash
jack_wait -w
exec pd -audiobuf 0 -blocksize 128 -nogui -jack _main.pd

