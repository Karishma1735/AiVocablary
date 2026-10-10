#!/usr/bin/env bash
# Builds the Embarko upload from the repo root: bash deploy/embarko/package.sh  ->  /tmp/vocabrise-embarko.tar.gz
# Then: curl -X POST https://ship.embarko.ai/apps -H "Authorization: Bearer $DEPLOY_TOKEN" -H "X-App-Name: vocabrise-ai" -H "X-Agent-Name: claude-code" -F "source=@/tmp/vocabrise-embarko.tar.gz"
set -euo pipefail
npm run build
STAGE=$(mktemp -d)
tar -c --exclude=node_modules --exclude=.git --exclude='.env*' --exclude=package-lock.json --exclude=prisma/dev.db --exclude=prisma/dev.db-journal --exclude=.claude --exclude=deploy . | tar -x -C "$STAGE"
cp deploy/embarko/start.js "$STAGE/server/start.js"
sed -i "s#'../server/index.js'#'./index.js'#" "$STAGE/server/start.js"
python3 - "$STAGE/package.json" <<'PY'
import json,sys
p=sys.argv[1];d=json.load(open(p))
d['dependencies']['prisma']=d['devDependencies'].pop('prisma')
d['scripts']['start']='node server/start.js'
d['scripts']['postinstall']='prisma generate'
json.dump(d,open(p,'w'),indent=2)
PY
tar -czf /tmp/vocabrise-embarko.tar.gz -C "$STAGE" .
echo "Wrote /tmp/vocabrise-embarko.tar.gz"
