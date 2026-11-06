#!/bin/sh
# usage: load-doc.sh in.json  -> load a model into the open tab (one undo step)
JS=$(python3 -c "
import json, sys
print('window.__studio.setDoc(' + json.dumps(open(sys.argv[1]).read()) + '); \"loaded\"')" "$1")
"$(dirname "$0")/eval.sh" "$JS"
