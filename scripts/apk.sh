#!/usr/bin/env bash
# Compila el APK de depuración sin Android Studio: web (vue-tsc + vite) → cap sync → gradlew assembleDebug.
#
#   pnpm apk                 # android/app/build/outputs/apk/debug/app-debug.apk
#   APK_OUT=~/x.apk pnpm apk # además copia el APK a esa ruta
#
# Necesita un JDK 21 (Gradle 8.14 no corre sobre el JDK 25 del sistema) y un SDK con platform 36 y
# build-tools 36: JAVA_HOME / ANDROID_HOME si están definidos; si no, ~/.jdks/jdk-21* y ~/android-sdk
# (véase el README, «APK desde WSL»). Escribe android/local.properties (ignorado por git) con el SDK.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${JAVA_HOME:-}" ]]; then
  for d in "$HOME"/.jdks/jdk-21*; do [[ -x "$d/bin/javac" ]] && JAVA_HOME="$d" && break; done
fi
if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/javac" ]]; then
  echo "No hay JDK 21: define JAVA_HOME o descomprime Temurin 21 en ~/.jdks/" >&2; exit 1
fi
ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
if [[ ! -d "$ANDROID_HOME/platforms" ]]; then
  echo "No hay SDK de Android en $ANDROID_HOME: define ANDROID_HOME (véase el README)" >&2; exit 1
fi
export JAVA_HOME ANDROID_HOME

cd "$ROOT"
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}" pnpm build
npx cap sync android
( cd android && ./gradlew assembleDebug --no-daemon --console=plain -q )
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
echo "APK: $APK ($(du -h "$APK" | cut -f1))"
if [[ -n "${APK_OUT:-}" ]]; then cp "$APK" "$APK_OUT" && echo "Copiado a $APK_OUT"; fi
