# One process serves the website and the AI practice API.
.DEFAULT_GOAL := run

PYTHON ?= python3
PORT ?= 8765
WENZHI_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

.PHONY: run start ai dev help check-python test test-python test-js

run start ai dev: check-python
	@printf '%s\n' '启动网页 + AI 练习服务（不会自动调用模型）' '打开 http://127.0.0.1:$(PORT)/' '停止：Ctrl+C；重启：停止后重新执行 make run'
	@cd "$(WENZHI_DIR)" && "$(PYTHON)" -u server.py --port "$(PORT)"

check-python:
	@"$(PYTHON)" -c 'import sys; assert sys.version_info >= (3, 9), "需要 Python 3.9 或更新版本"'

help:
	@printf '%s\n' \
	  'make / make run     一起启动网页与 AI 练习接口' \
	  'make run PORT=8766  使用其他本机端口' \
	  'make start / ai     与 make run 相同，前台运行' \
	  '停止：Ctrl+C；重启：停止后重新执行 make run' \
	  '启动后：网页「模型配置」填写 Base URL / API Key / model' \
	  'make test           运行 Python 与 JS 测试（需 Node.js）' \
	  'make test-python    只运行 Python 本机模拟模型测试' \
	  'PYTHON=/path/python 可指定 Python 可执行文件'

test: test-python test-js

test-python: check-python
	@cd "$(WENZHI_DIR)" && "$(PYTHON)" -m unittest discover -s tests -v

test-js:
	@cd "$(WENZHI_DIR)" && node --test
