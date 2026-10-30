#!/usr/bin/env bash
# Tighten the generated Android manifest. gen/ is recreated by tauri android init.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
manifest="$root/src-tauri/gen/android/app/src/main/AndroidManifest.xml"
res="$root/src-tauri/gen/android/app/src/main/res/xml"
if [ ! -f "$manifest" ]; then
  echo "Android manifest is missing. Run tauri android init first." >&2
  exit 1
fi
mkdir -p "$res"
cat > "$res/network_security_config.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
EOF
python3 - "$manifest" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text()
if "android:debuggable=\"true\"" in text:
    raise SystemExit("Main manifest marks the app debuggable")
if "<application" not in text:
    raise SystemExit("Android manifest has no application tag")
def ensure(attr: str, value: str, source: str) -> str:
    if attr in source:
        return source
    return source.replace("<application", f"<application {attr}=\"{value}\"", 1)
text = ensure("android:allowBackup", "false", text)
text = ensure("android:usesCleartextTraffic", "false", text)
text = ensure("android:networkSecurityConfig", "@xml/network_security_config", text)
path.write_text(text)
print("Hardened", path)
PY
if grep -n 'android:exported="true"' "$manifest" | grep -v 'MainActivity' | grep -v '.MainActivity' >/dev/null; then
  echo "Review exported components:" >&2
  grep -n 'android:exported' "$manifest" >&2 || true
fi
echo "INTERNET is the only permission the WebView needs. Manifest permissions:"
grep -n 'uses-permission' "$manifest" || echo "(none declared in the main manifest)"
