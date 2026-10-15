#!/bin/bash
# Build the pinned ranuts/document release into ./dist (needs git, Node >= 20.19).
set -e
REPO=https://github.com/ranuts/document.git
COMMIT=03e6b7cdee7a827fab57ec3e8bc9a69b0866f27e
cd "$(dirname "$0")"
if [ ! -d .work/.git ]; then
  git clone --filter=blob:none "$REPO" .work
fi
git -C .work fetch --quiet origin
git -C .work checkout --quiet --force "$COMMIT"
git -C .work clean --quiet -fd lib
# Local changes on top of upstream (AGPL: the patches are the modified source)
for patch in patches/*.patch; do
  git -C .work apply --whitespace=nowarn "../$patch"
done
(cd .work && npx -y pnpm@11.4.0 install --frozen-lockfile && npx -y pnpm@11.4.0 run build)
rm -rf dist
cp -r .work/dist dist
echo "Built ranuts/document $COMMIT into $(pwd)/dist"
