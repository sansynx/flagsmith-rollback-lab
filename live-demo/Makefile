.PHONY: setup demo web test

setup:
	bash scripts/setup.sh

demo: setup
	node server/demo.mjs

web: setup
	npm ci
	npm run build
	npm start

test:
	npm test
