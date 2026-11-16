#!/bin/sh
# Copie les fichiers du DSFR dans vendor/dsfr/ pour que le widget soit auto-hébergé
# (aucun appel à un CDN depuis une page qui affiche des données d'élèves).
# Prérequis : npm install (installe @gouvfr/dsfr dans node_modules).
set -eu

SRC="node_modules/@gouvfr/dsfr"
DEST="vendor/dsfr"

[ -d "$SRC/dist" ] || { echo "Lance d'abord : npm install" >&2; exit 1; }

rm -rf "$DEST"
mkdir -p vendor
cp -r "$SRC/dist" "$DEST"
cp "$SRC/LICENSE.md" "$DEST/LICENSE.md"

echo "DSFR $(node -p "require('./$SRC/package.json').version") copié dans $DEST"
