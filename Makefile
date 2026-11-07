.DEFAULT_GOAL := help

# Include directory timestamps so removing an input also invalidates the build.
BUILD_INPUTS := $(shell find src demo -type f -o -type d) tools/build.mjs tools/build-demo-feed.ts package.json package-lock.json
BUILD_STAMP := build/.make-build-stamp
BUILD_OUTPUTS := build/server.mjs public/vendor/document-runtime.mjs public/vendor/analytics.mjs public/vendor/workload.mjs public/vendor/voice.mjs public/react/finances.mjs public/demo/today.json
MISSING_OUTPUTS := $(filter-out $(wildcard $(BUILD_OUTPUTS)),$(BUILD_OUTPUTS))

.PHONY: help install lint test build docker FORCE
help:
	@printf '%s\n' 'make install  Install locked Node dependencies' 'make lint     Check source style' 'make test     Run the existing test suite' 'make build    Build changed sources' 'make docker   Build the standalone Docker image'

install:
	npm ci --ignore-scripts

lint:
	npm run lint

test:
	npm test

build: $(BUILD_STAMP)

ifneq ($(strip $(MISSING_OUTPUTS)),)
$(BUILD_STAMP): FORCE
endif
$(BUILD_STAMP): $(BUILD_INPUTS)
	npm run build
	@touch $@

docker:
	docker build --target runtime -t lifeos-open .
