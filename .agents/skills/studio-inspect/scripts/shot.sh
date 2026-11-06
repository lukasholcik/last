#!/bin/sh
# usage: [VIEW=3d|work|top|side|section] shot.sh out.png ['{ortho:false,position:[x,y,z],target:[x,y,z]}']
# Switches the tab to the 3D view, optionally sets the camera, saves a screenshot.
# Without a camera it keeps the user's current view (read it first with
# eval.sh 'JSON.stringify(window.__viewer3d.camera())').
H="$(dirname "$0")"
P=$("$H/page.sh") || { echo "no /studio tab open in Orca" >&2; exit 1; }
"$H/eval.sh" "window.__studio.setView('${VIEW:-3d}'); 'ok'" >/dev/null
sleep 1
[ -n "$2" ] && "$H/eval.sh" "window.__viewer3d.setCamera($2); \"ok\"" >/dev/null && sleep 1
orca screenshot --page "$P" --json | python3 -c "
import base64, json, sys
open(sys.argv[1], 'wb').write(base64.b64decode(json.load(sys.stdin)['result']['data']))" "$1"
echo "saved $1"
