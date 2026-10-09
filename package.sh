#!/bin/sh
# Build a Chrome Web Store upload zip from the manifest version.
set -e
cd "$(dirname "$0")"
v=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' manifest.json)
mkdir -p dist
rm -f "dist/laravel-cloud-dark-$v.zip"
zip -qr "dist/laravel-cloud-dark-$v.zip" manifest.json dark.css dark.js icons
echo "dist/laravel-cloud-dark-$v.zip"
