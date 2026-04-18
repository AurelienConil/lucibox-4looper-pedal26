#!/bin/bash
jack_wait -w
exec pd -nogui -jack -rt _main.pd

