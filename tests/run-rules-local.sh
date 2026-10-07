#!/usr/bin/env bash
# Runs tests/firestore.test.mjs against the official Firestore emulator without npm packages
# (uses tests/rest-shim instead of firebase + @firebase/rules-unit-testing). Needs Java + Node.
set -euo pipefail
cd "$(dirname "$0")/.."
JAR=${FIRESTORE_EMULATOR_JAR:-$HOME/.cache/firestore-emulator.jar}
[ -f "$JAR" ] || curl -sSfo "$JAR" https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.19.8.jar
java -jar "$JAR" --host 127.0.0.1 --port 8080 >/tmp/firestore-emulator.log 2>&1 & PID=$!
trap 'kill $PID' EXIT
for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:8080/ && break; sleep 1; done
T=$(mktemp --suffix=.test.mjs)
sed -e "s#'@firebase/rules-unit-testing'#'$PWD/tests/rest-shim/rut.mjs'#" -e "s#'firebase/firestore'#'$PWD/tests/rest-shim/firestore.mjs'#" \
    -e "s#new URL('../firebase/firestore.rules', import.meta.url)#'$PWD/firebase/firestore.rules'#" tests/firestore.test.mjs > "$T"
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy node --test "$T"
