.PHONY: demo web test
demo web:
	$(MAKE) -C live-demo $@
test:
	python -m unittest discover -s tests -v
	$(MAKE) -C live-demo test
