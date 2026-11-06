#!/bin/sh
# Print the Orca browser page id of the open /studio tab (exit 1 if none).
orca tab list --json | python3 -c "
import json, sys
tabs = json.load(sys.stdin)
tabs = tabs.get('result', tabs)
tabs = tabs.get('tabs', tabs) if isinstance(tabs, dict) else tabs
for t in tabs:
    if '/studio' in (t.get('url') or ''):
        print(t.get('browserPageId') or t.get('pageId') or t.get('id')); break
else:
    sys.exit(1)"
