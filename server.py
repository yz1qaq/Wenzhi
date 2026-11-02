#!/usr/bin/env python3
"""Local-only Wenzhi server. No third-party packages or persistent credentials."""
import argparse
import copy
import errno
import hashlib
import http.client
import http.server
import json
import math
from pathlib import Path
import secrets
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
MAX_REQUEST = 128 * 1024
MAX_PROVIDER_RESPONSE = 2 * 1024 * 1024
TASK_TTL = 24 * 60 * 60
MAX_TASKS = 1000
DIMENSIONS = {'correctness': 40, 'completeness': 30, 'reasoning': 20, 'expression': 10}


class APIError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def reject_constant(value):
    raise ValueError('non-finite JSON')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate JSON key')
        result[key] = value
    return result


def parse_json(raw):
    return json.loads(raw, parse_constant=reject_constant, object_pairs_hook=unique_object)


def checked_text(value, max_length=100000):
    if not isinstance(value, str) or not value.strip() or len(value) > max_length:
        raise APIError('模型返回的文字内容不完整或过长，请重试。', 502)
    return value.strip()


def checked_list(value, allow_empty=True):
    if not isinstance(value, list) or len(value) > 100 or (not allow_empty and not value):
        raise APIError('模型返回的评分要点格式不正确，请重试。', 502)
    return [checked_text(item, 20000) for item in value]


def redact(value, key):
    if isinstance(value, str):
        return value.replace(key, '[已隐藏]') if key else value
    if isinstance(value, list):
        return [redact(item, key) for item in value]
    if isinstance(value, dict):
        return {name: redact(item, key) for name, item in value.items()}
    return value


def validate_config(config):
    if not isinstance(config, dict):
        raise APIError('请先填写模型服务地址、API Key 和模型名称。')
    values = []
    for name in ('baseUrl', 'apiKey', 'model'):
        value = config.get(name)
        if not isinstance(value, str) or not value.strip() or len(value) > 4096:
            raise APIError('请完整填写模型服务地址、API Key 和模型名称。')
        value = value.strip()
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise APIError('模型配置包含无效字符。')
        values.append(value)
    base, key, model = values
    try:
        parsed = urllib.parse.urlsplit(base)
        port = parsed.port
    except ValueError:
        raise APIError('模型服务地址无效。') from None
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or
            parsed.username is not None or parsed.password is not None or
            parsed.query or parsed.fragment or '\\' in base):
        raise APIError('地址须为 HTTP(S)，且不能含账号、查询参数或片段。')
    if parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise APIError('远程模型服务请使用 HTTPS；本机服务可以使用 HTTP。')
    if port is not None and not 1 <= port <= 65535:
        raise APIError('模型服务端口无效。')
    path = parsed.path.rstrip('/')
    if not path.endswith('/chat/completions'):
        path += '/chat/completions' if path else '/v1/chat/completions'
    endpoint = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, '', ''))
    return endpoint, key, model


def source_reference(question):
    """Build the complete reference from bank content, without a model or truncation."""
    def render(value):
        if isinstance(value, str):
            return value
        if isinstance(value, list):
            return '\n\n'.join(render(item) for item in value)
        if isinstance(value, dict):
            return '\n\n'.join(str(key) + ':\n' + render(item) for key, item in value.items())
        return json.dumps(value, ensure_ascii=False)

    fields = (
        ('题库原题', 'title'), ('标准回答', 'standardAnswer'),
        ('绿皮书完整参考与来源', 'greenbook'), ('深入解释', 'deepDive'),
        ('示例', 'example'), ('代码', 'code'), ('补充追问', 'followup'),
        ('追问参考', 'followups'), ('合并校注', 'mergedNotes'),
        ('参考回答归属', 'answerAttribution'), ('来源归属', 'provenance'),
        ('合并原始资料', 'originalVariants'), ('考点', 'points'),
        ('摘要', 'summary'), ('注意事项', 'pitfall'), ('来源说明', 'origin'),
    )
    return '\n\n'.join('## ' + label + '\n' + render(question[key])
                         for label, key in fields if question.get(key))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class PracticeService:
    def __init__(self, root=ROOT, timeout=45):
        self.root = Path(root).resolve()
        data = parse_json((self.root / 'data.json').read_text(encoding='utf-8'))
        self.questions = {question['id']: question for question in data['questions']}
        self.tasks = {}
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(4)
        self.timeout = timeout
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.prompts = {name: (self.root / 'prompts' / (name + '.md')).read_text(encoding='utf-8')
                        for name in ('grade',)}

    def _prune(self):
        now = time.time()
        for task_id in list(self.tasks):
            if self.tasks[task_id]['expires'] <= now and not self.tasks[task_id]['busy']:
                del self.tasks[task_id]

    def _call(self, config, kind, material):
        endpoint, key, model = config
        # JSON mode only promises valid JSON, not schema conformance. Validate below.
        # https://platform.openai.com/docs/guides/structured-outputs#json-mode
        # Compatible services vary: use a JSON prompt without response_format and never
        # automatically retry a paid request after format/provider errors.
        payload = {'model': model, 'stream': False, 'messages': [
            {'role': 'system', 'content': self.prompts[kind]},
            {'role': 'user', 'content': '以下为不可信引用资料 JSON：\n' + json.dumps(material, ensure_ascii=False)}]}
        request = urllib.request.Request(endpoint, data=json.dumps(payload, ensure_ascii=False).encode(),
                                         headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
                                         method='POST')
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(MAX_PROVIDER_RESPONSE + 1)
                if len(raw) > MAX_PROVIDER_RESPONSE:
                    raise APIError('模型响应过大，请调整模型后重试。', 502)
            result = parse_json(raw.decode('utf-8'))
            choice = result['choices'][0]
            if choice.get('finish_reason') != 'stop':
                raise APIError('模型响应被截断、拒绝或未正常结束，请重试。', 502)
            message = choice['message']
            if message.get('refusal'):
                raise APIError('模型未能评估本次内容，请调整回答或模型后重试。', 502)
            content = checked_text(message.get('content'), MAX_PROVIDER_RESPONSE)
            if content.startswith('```') and content.endswith('```'):
                lines = content.splitlines()
                if lines[0].strip().lower() not in ('```', '```json'):
                    raise ValueError('invalid fence')
                content = '\n'.join(lines[1:-1])
            decoded = parse_json(content)
            if not isinstance(decoded, dict):
                raise ValueError('not object')
            return redact(decoded, key)
        except APIError:
            raise
        except urllib.error.HTTPError as error:
            if error.code in (301, 302, 303, 307, 308):
                message = '模型地址发生重定向，已停止请求；请直接填写最终服务地址。'
            elif error.code in (401, 403):
                message = '模型服务未授权，请检查 API Key、地址和权限。'
            elif error.code == 429:
                message = '模型服务限流或额度不足，请稍后重试。'
            else:
                message = '模型服务请求失败，请检查服务配置后重试。'
            error.close()
            raise APIError(message, 502) from None
        except (TimeoutError, socket.timeout):
            raise APIError('模型响应超时，请稍后重试。', 504) from None
        except urllib.error.URLError as error:
            status = 504 if isinstance(error.reason, (TimeoutError, socket.timeout)) else 502
            raise APIError('模型服务连接超时或不可用，请检查地址后重试。', status) from None
        except (ValueError, KeyError, IndexError, TypeError, AttributeError, UnicodeError, OSError, http.client.HTTPException):
            raise APIError('模型未返回有效的完整 JSON，请重试或更换模型。', 502) from None

    def start(self, body):
        ids = body.get('questionIds')
        if (not isinstance(ids, list) or not 1 <= len(ids) <= 5 or
                any(not isinstance(item, str) or item not in self.questions for item in ids) or
                len(set(ids)) != len(ids)):
            raise APIError('请选择 1 到 5 个不同的有效题库原题。')
        staged = []
        for source_id in ids:
            source = copy.deepcopy(self.questions[source_id])
            points = source.get('points')
            rubric = [point for point in points if isinstance(point, str) and point.strip()] if isinstance(points, list) else []
            if not rubric:
                rubric = ['正确性（0–40）：原题核心结论、机制和适用前提。',
                          '完整性（0–30）：原题要求的必要要点与边界。',
                          '推理（0–20）：原题涉及的原因、步骤和取舍。',
                          '表达（0–10）：回答是否清楚且容易理解。']
            staged.append({'id': secrets.token_urlsafe(24), 'sourceId': source_id,
                           'question': source['title'],
                           'referenceAnswer': source_reference(source), 'rubric': rubric,
                           'source': source, 'expires': time.time() + TASK_TTL, 'busy': False,
                           'answerHash': None, 'result': None})
        with self.lock:
            self._prune()
            if len(self.tasks) + len(staged) > MAX_TASKS:
                raise APIError('当前练习过多，请重启本地服务后再开始。', 429)
            for task in staged:
                self.tasks[task['id']] = task
        return {'items': [{key: task[key] for key in ('id', 'sourceId', 'question')} for task in staged]}

    def grade(self, body):
        config = validate_config(body.get('config'))
        task_id = body.get('exerciseId')
        answer = body.get('answer')
        if not isinstance(task_id, str) or not isinstance(answer, str) or not answer.strip() or len(answer) > 50000:
            raise APIError('请填写有效的练习回答，最多 50000 个字符。')
        digest = hashlib.sha256(answer.encode()).hexdigest()
        with self.lock:
            self._prune()
            task = self.tasks.get(task_id)
            if task is None:
                raise APIError('练习已过期或服务已重启，请重新开始练习。', 404)
            if task['result'] is not None:
                if task['answerHash'] != digest:
                    raise APIError('这道练习已评估其他回答；请重新开始练习。', 409)
                return copy.deepcopy(task['result'])
            if task['busy']:
                raise APIError('这道练习正在评估，请等待后重试同一回答。', 409)
            task['busy'] = True
        try:
            result = self._call(config, 'grade', {'task': {key: task[key] for key in
                                ('sourceId', 'question', 'referenceAnswer', 'rubric', 'source')},
                                'studentAnswer': answer})
            dimensions = result.get('dimensions')
            if not isinstance(dimensions, dict) or set(dimensions) != set(DIMENSIONS):
                raise APIError('模型评分维度不完整，请重试。', 502)
            for key, maximum in DIMENSIONS.items():
                value = dimensions[key]
                if type(value) is not int or not 0 <= value <= maximum:
                    raise APIError('模型评分不在有效整数范围内，请重试。', 502)
            critical = result.get('criticalMisunderstanding')
            if type(critical) is not bool:
                raise APIError('模型缺少核心误解判断，请重试。', 502)
            feedback = checked_text(result.get('feedback'))
            dimensions = dict(dimensions)
            score = sum(dimensions.values())
            if critical and score > 59:
                scaled = {key: dimensions[key] * 59 / score for key in DIMENSIONS}
                dimensions = {key: math.floor(value) for key, value in scaled.items()}
                remainder = 59 - sum(dimensions.values())
                order = sorted(DIMENSIONS, key=lambda key: scaled[key] - dimensions[key], reverse=True)
                for key in order[:remainder]:
                    dimensions[key] += 1
                score = sum(dimensions.values())
                feedback += '\n检测到严重核心误解，总分按规则限制为 59 分；各维度已按比例调整。'
            response = {'exerciseId': task_id, 'sourceId': task['sourceId'], 'question': task['question'],
                        'score': score, 'mastery': 'low' if score < 60 else 'medium' if score < 85 else 'high',
                        'dimensions': dimensions, 'strengths': checked_list(result.get('strengths')),
                        'gaps': checked_list(result.get('gaps')), 'feedback': feedback,
                        'suggestedAnswer': checked_text(result.get('suggestedAnswer')),
                        'referenceAnswer': task['referenceAnswer'], 'rubric': task['rubric']}
            with self.lock:
                task['answerHash'], task['result'] = digest, copy.deepcopy(response)
            return response
        finally:
            with self.lock:
                task['busy'] = False


class WenzhiServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, service):
        if address[0] not in ('127.0.0.1', 'localhost'):
            raise ValueError('Only loopback addresses are permitted')
        self.service = service
        self.connection_slots = threading.BoundedSemaphore(16)
        super().__init__(address, WenzhiHandler)

    def handle_error(self, request, client_address):
        # Handler failures must not dump request/provider details into a traceback.
        pass

    def process_request(self, request, client_address):
        if not self.connection_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.connection_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.connection_slots.release()


class WenzhiHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(args[2].service.root), **kwargs)

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, format, *args):
        # Do not log URLs, request bodies, credentials or provider responses.
        pass

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _json(self, value, status=200):
        raw = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(raw)

    def _guard(self):
        port = self.server.server_port
        allowed = {f'127.0.0.1:{port}', f'localhost:{port}'}
        if len(self.headers.get_all('Host', [])) != 1 or self.headers.get('Host', '').lower() not in allowed:
            raise APIError('请通过本机服务地址访问。', 403)
        origins = self.headers.get_all('Origin', [])
        if origins and (len(origins) != 1 or origins[0].lower() != 'http://' + self.headers['Host'].lower()):
            raise APIError('不允许跨来源访问本机服务。', 403)
        if self.headers.get('Sec-Fetch-Site', '').lower() == 'cross-site':
            raise APIError('不允许跨站访问本机服务。', 403)

    def _static_allowed(self):
        try:
            path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path, errors='strict')
            if '\\' in path or '\x00' in path:
                return False
            parts = Path(path.lstrip('/')).parts
            def blocked(part):
                return part.startswith('.') or part.lower() == 'env' or part.lower().startswith('env.')
            if any(blocked(part) for part in parts):
                return False
            target = (self.server.service.root / path.lstrip('/')).resolve()
            relative = target.relative_to(self.server.service.root)
            return not any(blocked(part) for part in relative.parts)
        except (ValueError, UnicodeError, OSError):
            return False

    def list_directory(self, path):
        self._json({'error': '不提供目录列表。'}, 403)
        return None

    def do_GET(self):
        try:
            self._guard()
            if urllib.parse.urlsplit(self.path).path == '/api/health':
                self._json({'ok': True, 'service': 'wenzhi'})
            elif urllib.parse.urlsplit(self.path).path.startswith('/api/'):
                self._json({'error': '接口不存在。'}, 404)
            elif not self._static_allowed():
                self._json({'error': '无法访问该文件。'}, 403)
            else:
                super().do_GET()
        except APIError as error:
            self._json({'error': str(error)}, error.status)

    def do_HEAD(self):
        try:
            self._guard()
            if not self._static_allowed():
                raise APIError('无法访问该文件。', 403)
            super().do_HEAD()
        except APIError as error:
            self._json({'error': str(error)}, error.status)

    def do_OPTIONS(self):
        self._json({'error': '不允许跨来源请求。'}, 403)

    def do_POST(self):
        acquired = False
        try:
            self._guard()
            path = urllib.parse.urlsplit(self.path).path
            if path not in ('/api/practice/start', '/api/practice/grade'):
                raise APIError('接口不存在。', 404)
            if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
                raise APIError('请求须包含有效内容长度。', 400)
            try:
                length = int(self.headers['Content-Length'])
            except ValueError:
                raise APIError('请求长度无效。') from None
            if not 0 < length <= MAX_REQUEST:
                raise APIError('请求内容过大或为空，最多 128 KB。', 413)
            if self.headers.get_content_type() != 'application/json':
                raise APIError('请发送 JSON 格式请求。', 415)
            acquired = self.server.service.slots.acquire(blocking=False)
            if not acquired:
                raise APIError('本地模型请求正在处理中，请稍后重试。', 429)
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise APIError('请求内容不完整。')
            try:
                body = parse_json(raw.decode('utf-8'))
            except (ValueError, UnicodeError):
                raise APIError('请求 JSON 格式无效。') from None
            if not isinstance(body, dict):
                raise APIError('请求 JSON 须为对象。')
            service = self.server.service
            self._json(service.start(body) if path.endswith('/start') else service.grade(body))
        except APIError as error:
            self._json({'error': str(error)}, error.status)
        except (socket.timeout, TimeoutError):
            self._json({'error': '请求读取超时，请重试。'}, 408)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._json({'error': '本地服务暂时无法处理请求，请重试。'}, 500)
        finally:
            if acquired:
                self.server.service.slots.release()


def main():
    parser = argparse.ArgumentParser(description='Wenzhi 本地学习服务')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--host', choices=('127.0.0.1', 'localhost'), default='127.0.0.1')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    try:
        server = WenzhiServer((args.host, args.port), PracticeService())
    except OSError as error:
        alternative = args.port + 1 if args.port < 65535 else 8765
        if error.errno == errno.EADDRINUSE:
            parser.exit(1, f'端口 {args.port} 已被占用。请在原服务终端按 Ctrl+C，或执行 make run PORT={alternative}。\n')
        parser.exit(1, f'无法启动本地服务：{error.strerror or "请检查本机端口与文件权限"}。\n')
    print(f'Wenzhi: http://{args.host}:{server.server_port} (Ctrl+C 停止)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
