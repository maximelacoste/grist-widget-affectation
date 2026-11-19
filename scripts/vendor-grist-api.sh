#!/bin/sh
# Copie l'API de plugin Grist de VOTRE instance dans vendor/grist/ (même logique que le DSFR) : le widget tourne avec
# l'accès « full » au document, donc on évite de charger ce script depuis un site tiers à chaque ouverture, et on
# fige la version qui correspond à l'instance. Le paquet npm « grist-plugin-api » n'est pas une source fiable (version 0.0.1).
# Usage : sh scripts/vendor-grist-api.sh https://<votre-instance-grist>
# Ensuite, dans index.html, remplacer la balise <script src="https://docs.getgrist.com/grist-plugin-api.js"> par
# <script src="vendor/grist/grist-plugin-api.js"></script>, tester sur l'instance, puis commiter.
set -eu

INSTANCE="${1:?Usage : sh scripts/vendor-grist-api.sh https://<votre-instance-grist>}"
INSTANCE="${INSTANCE%/}"

mkdir -p vendor/grist
curl -fsSL "$INSTANCE/grist-plugin-api.js" -o vendor/grist/grist-plugin-api.js
{ echo "source: $INSTANCE/grist-plugin-api.js"; echo "date: $(date +%F)"; echo "sha256: $(sha256sum vendor/grist/grist-plugin-api.js | cut -d' ' -f1)"; } > vendor/grist/VERSION
echo "API de plugin Grist copiée dans vendor/grist/ :"; cat vendor/grist/VERSION
