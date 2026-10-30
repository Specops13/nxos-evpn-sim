#!/usr/bin/env bash
# Install the Android SDK packages Tauri's APK build needs.
#
# android-actions/setup-android downloads its own cmdline-tools and then runs
# `sdkmanager --licenses`, which exits 1 on the hosted runner ("7 of 8 SDK
# package licenses not accepted") before any package is installed. Use the
# image's SDK instead and accept licenses without that action.
set -euo pipefail

sdk_root=""
for candidate in "${ANDROID_SDK_ROOT:-}" "${ANDROID_HOME:-}" /usr/local/lib/android/sdk; do
  if [ -n "$candidate" ] && [ -x "$candidate/cmdline-tools/latest/bin/sdkmanager" ]; then
    sdk_root="$candidate"
    break
  fi
done
if [ -z "$sdk_root" ]; then
  echo "sdkmanager was not found under ANDROID_SDK_ROOT, ANDROID_HOME, or /usr/local/lib/android/sdk" >&2
  find /usr/local/lib/android /opt -name sdkmanager -type f 2>/dev/null || true
  exit 1
fi

sdkmanager="$sdk_root/cmdline-tools/latest/bin/sdkmanager"
echo "Using sdkmanager at $sdkmanager"
"$sdkmanager" --version

mkdir -p "$sdk_root/licenses"
# Hashes of the standard Android SDK licenses. sdkmanager still prompts when a
# hash is missing, so the yes-pipe below covers a newer license text.
cat > "$sdk_root/licenses/android-sdk-license" <<'EOF'
8933bad161af4178b1185d1a37fbf41ea5269c55
d56f5187479451eabf01fb78af6dfcb131a6481e
24333f8a63b6825ea9c5514f83c2829b004d1fee
EOF
printf '%s\n' 84831b9409646161da1b5aa1e5434b1d7d2c724a > "$sdk_root/licenses/android-sdk-preview-license"
printf '%s\n' 33b6a2b64607f11b759f320ef9dff4ae6c47d97a > "$sdk_root/licenses/google-gdk-license"

set +o pipefail
yes | timeout 120 "$sdkmanager" --sdk_root="$sdk_root" --licenses >/tmp/sdk-licenses.log || true
set -o pipefail

"$sdkmanager" --sdk_root="$sdk_root" --install \
  "platforms;android-35" \
  "platforms;android-36" \
  "build-tools;35.0.0" \
  "ndk;27.2.12479018"

# Tauri CLI 2.12 generates compileSdk 37. cmdline-tools 12 on the runner
# reports "Failed to find package platforms;android-37", so replace it with
# a current sdkmanager before installing that platform.
if [ ! -d "$sdk_root/platforms/android-37" ]; then
  upgraded=0
  tmp="$(mktemp -d)"
  for build in 16111833 14742923 13114758; do
    url="https://dl.google.com/android/repository/commandlinetools-linux-${build}_latest.zip"
    echo "Downloading cmdline-tools $build"
    if curl -fL --retry 3 --retry-delay 2 -o "$tmp/cmdtools.zip" "$url"; then
      rm -rf "$sdk_root/cmdline-tools/latest" "$tmp/unpack"
      mkdir -p "$sdk_root/cmdline-tools" "$tmp/unpack"
      unzip -q "$tmp/cmdtools.zip" -d "$tmp/unpack"
      if [ -d "$tmp/unpack/cmdline-tools/bin" ]; then
        mv "$tmp/unpack/cmdline-tools" "$sdk_root/cmdline-tools/latest"
        upgraded=1
        break
      fi
      echo "cmdline-tools $build unpacked without bin/sdkmanager" >&2
    fi
  done
  rm -rf "$tmp"
  if [ "$upgraded" -ne 1 ]; then
    echo "Could not install a cmdline-tools build that knows platforms;android-37" >&2
    exit 1
  fi
  sdkmanager="$sdk_root/cmdline-tools/latest/bin/sdkmanager"
  echo "Using sdkmanager at $sdkmanager"
  "$sdkmanager" --version
  set +o pipefail
  yes | timeout 120 "$sdkmanager" --sdk_root="$sdk_root" --licenses >/tmp/sdk-licenses.log || true
  set -o pipefail
  "$sdkmanager" --sdk_root="$sdk_root" --install "platforms;android-37" "build-tools;36.0.0"
fi
if [ ! -d "$sdk_root/platforms/android-37" ]; then
  echo "platforms;android-37 is required (Tauri compileSdk 37) and was not installed" >&2
  exit 1
fi

ndk="$sdk_root/ndk/27.2.12479018"
if [ ! -d "$ndk" ]; then
  echo "NDK 27.2.12479018 was not installed under $sdk_root/ndk" >&2
  ls -la "$sdk_root/ndk" >&2 || true
  exit 1
fi

{
  echo "ANDROID_HOME=$sdk_root"
  echo "ANDROID_SDK_ROOT=$sdk_root"
  echo "ANDROID_NDK_HOME=$ndk"
  echo "NDK_HOME=$ndk"
} >> "${GITHUB_ENV:-/dev/null}"

echo "Android SDK ready at $sdk_root"
echo "NDK ready at $ndk"
