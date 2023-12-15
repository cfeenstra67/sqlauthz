#!/bin/bash

pnpm readme:npm

trap "pnpm readme:git" EXIT

VERSION=$(cat package.json | jq -r .version)

TAG=$( [[ $VERSION =~ -([a-z]+)[0-9]+$ ]] && echo ${BASH_REMATCH[1]} || echo latest )

pnpm publish --access public --no-git-checks --tag $TAG