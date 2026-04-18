#!/bin/bash
jack_wait -w
exec pd -nogui -jack _main.pd

