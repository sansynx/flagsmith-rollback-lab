.PHONY: demo web test skill-demo
demo web:
	$(MAKE) -C live-demo $@
skill-demo:
	$(MAKE) -C live-demo setup
	node live-demo/scripts/verify-skill.mjs
test:
	python -m unittest discover -s tests -v
	python -m unittest discover -s tests/skills -v
	$(MAKE) -C live-demo test
