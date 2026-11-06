#!/bin/sh
# usage: save-doc.sh out.json   -> the LIVE model of the open tab (not the debounced save)
"$(dirname "$0")/eval.sh" 'window.__studio.doc()' | python3 -c "
import json, sys
print(json.dumps(json.loads(sys.stdin.read()), indent=1))" > "$1"
echo "saved $1 ($(wc -c < "$1") bytes)"
