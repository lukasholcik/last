#!/bin/sh
# usage: eval.sh '<js expression>'   -> prints the expression's result (a string)
P=$("$(dirname "$0")/page.sh") || { echo "no /studio tab open in Orca" >&2; exit 1; }
orca eval --page "$P" --expression "$1" --json | python3 -c "
import json, sys
r = json.load(sys.stdin)
if not r.get('ok'): sys.exit(r)
print(r['result']['result'])"
