#!/bin/sh
# Copie une version datée de l'API de plugin Grist dans vendor/grist/ (même logique que le DSFR) :
# le widget tourne avec l'accès « full » au document, donc on évite de charger ce script depuis un site tiers à chaque ouverture.
# Prérequis : accès au registre npm. Usage : sh scripts/vendor-grist-api.sh
# Ensuite, dans index.html, remplacer la balise <script src="https://docs.getgrist.com/grist-plugin-api.js"> par
# <script src="vendor/grist/grist-plugin-api.js"></script>, tester, puis commiter (la version est notée dans vendor/grist/VERSION).
set -eu

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

(cd "$TMP" && npm pack grist-plugin-api --silent >/dev/null && tar -xzf grist-plugin-api-*.tgz)
FICHIER="$(find "$TMP/package" -name 'grist-plugin-api.js' | head -n 1)"
[ -n "$FICHIER" ] || { echo "grist-plugin-api.js introuvable dans le paquet npm" >&2; exit 1; }

mkdir -p vendor/grist
cp "$FICHIER" vendor/grist/grist-plugin-api.js
node -p "require('$TMP/package/package.json').version" > vendor/grist/VERSION
echo "API de plugin Grist $(cat vendor/grist/VERSION) copiée dans vendor/grist/"
