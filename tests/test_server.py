"""HTTP integration tests. Local mocked provider only; no real keys or paid calls."""
import contextlib
import copy
import http.client
import http.server
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tempfile
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('wenzhi_server', ROOT / 'server.py')
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)

SOURCE = {'id': 'one', 'title': '  完整原题（保持原文）?  ',
          'standardAnswer': ['标准回答首段', '完整标准回答末段'],
          'points': ['本题关键评分点', '本题必要边界'],
          'greenbook': [
              {'id': 'g1', 'title': '来源 A 原题', 'markdown': '# 绿皮书 A\n绿皮书来源A完整末段',
               'expert': '来源 A 高手完整回答', 'sourceStatement': '来源 A 声明', 'sourceUrl': 'https://example.test/a'},
              {'id': 'g2', 'title': '来源 B 原题', 'markdown': '# 绿皮书 B\n绿皮书来源B完整末段',
               'expert': '来源 B 高手完整回答', 'sourceStatement': '来源 B 声明', 'sourceUrl': 'https://example.test/b'}],
          'mergedNotes': ['补充说明末段'], 'deepDive': ['深入解释末段'], 'example': '示例末段',
          'code': 'print("代码完整末段")', 'answerAttribution': '作者归属与未完成声明末段',
          'provenance': [{'statement': '原始来源归属完整末段'}],
          'followups': [{'question': '完整追问', 'answer': '完整追问答案末段'}]}
REFERENCE_TAILS = ('完整标准回答末段', '绿皮书来源A完整末段', '绿皮书来源B完整末段',
                   '来源 A 高手完整回答', '来源 B 高手完整回答', '来源 A 声明', '来源 B 声明',
                   '补充说明末段', '深入解释末段', '示例末段', '完整追问答案末段',
                   '代码完整末段', '作者归属与未完成声明末段', '原始来源归属完整末段')
GRADE = {'dimensions': {'correctness': 36, 'completeness': 26, 'reasoning': 18, 'expression': 9},
         'criticalMisunderstanding': False, 'strengths': ['因果正确'], 'gaps': ['补充边界'],
         'feedback': '说明边界情况', 'suggestedAnswer': '改进回答'}


class MockProvider(http.server.BaseHTTPRequestHandler):
    requests = []
    output = GRADE
    status = 200
    finish_reason = 'stop'
    refusal = None
    delay = 0
    redirect = None
    raw = None

    def log_message(self, *args):
        pass

    def do_POST(self):
        cls = type(self)
        raw = self.rfile.read(int(self.headers['Content-Length']))
        cls.requests.append({'path': self.path, 'headers': dict(self.headers), 'body': json.loads(raw)})
        if cls.delay:
            time.sleep(cls.delay)
        self.send_response(cls.status)
        if cls.redirect:
            self.send_header('Location', cls.redirect)
        self.end_headers()
        message = {'content': json.dumps(cls.output, ensure_ascii=False), 'refusal': cls.refusal}
        raw = cls.raw if cls.raw is not None else json.dumps({'choices': [{'finish_reason': cls.finish_reason, 'message': message}]}).encode()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        (cls.root / 'prompts').mkdir()
        for name in ('grade',):
            shutil.copy(ROOT / 'prompts' / (name + '.md'), cls.root / 'prompts')
        (cls.root / 'data.json').write_text(json.dumps({'questions': [SOURCE, {'id': 'two', 'title': '第二题原题', 'standardAnswer': ['第二题完整答案'], 'points': []}]}))
        (cls.root / 'index.html').write_text('<h1>Wenzhi</h1>')
        (cls.root / '.git').mkdir()
        (cls.root / '.git' / 'config').write_text('private git data')
        (cls.root / '.env').write_text('SECRET=never')
        (cls.root / 'env').write_text('SECRET=never')
        (cls.root / 'outside').symlink_to('/etc/passwd')
        (cls.root / 'hiddenlink').symlink_to(cls.root / '.git')
        cls.provider = http.server.ThreadingHTTPServer(('127.0.0.1', 0), MockProvider)
        cls.provider.daemon_threads = True
        cls.provider_thread = threading.Thread(target=cls.provider.serve_forever, daemon=True)
        cls.provider_thread.start()
        cls.service = backend.PracticeService(cls.root, timeout=.15)
        cls.server = backend.WenzhiServer(('127.0.0.1', 0), cls.service)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.provider.shutdown()
        cls.provider.server_close()
        cls.temp.cleanup()

    def setUp(self):
        MockProvider.requests = []
        MockProvider.output = copy.deepcopy(GRADE)
        MockProvider.status = 200
        MockProvider.finish_reason = 'stop'
        MockProvider.refusal = None
        MockProvider.delay = 0
        MockProvider.redirect = None
        MockProvider.raw = None
        self.service.tasks.clear()
        self.config = {'baseUrl': f'http://127.0.0.1:{self.provider.server_port}/v1',
                       'apiKey': 'fake-key-only-DoNotLeak', 'model': 'mock-model'}

    def request(self, method='POST', path='/api/practice/start', body=None, headers=None, raw=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        payload = raw if raw is not None else json.dumps(body or {'config': self.config, 'questionIds': ['one']}).encode()
        request_headers = {'Content-Type': 'application/json'}
        request_headers.update(headers or {})
        connection.request(method, path, body=payload if method == 'POST' else None, headers=request_headers)
        response = connection.getresponse()
        data, status, response_headers = response.read(), response.status, dict(response.getheaders())
        connection.close()
        try:
            result = json.loads(data)
        except ValueError:
            result = data.decode()
        return status, result, response_headers

    def start(self):
        status, result, _ = self.request()
        self.assertEqual(status, 200, result)
        return result['items'][0]['id']

    def grade(self, task_id, answer='我的回答', **extra):
        return self.request(path='/api/practice/grade', body={'config': self.config,
            'exerciseId': task_id, 'answer': answer, **extra})

    def test_health_static_and_no_cors(self):
        status, value, headers = self.request('GET', '/api/health')
        self.assertEqual((status, value), (200, {'ok': True, 'service': 'wenzhi'}))
        self.assertNotIn('Access-Control-Allow-Origin', headers)
        self.assertEqual(self.request('GET', '/')[0], 200)
        self.assertEqual(self.request('OPTIONS', '/api/practice/start')[0], 403)

    def test_host_and_origin_guards(self):
        port = self.server.server_port
        for headers in ({'Host': 'attacker.test'}, {'Origin': 'https://attacker.test'},
                        {'Origin': f'http://localhost:{port}'}, {'Origin': f'http://127.0.0.1:{port+1}'},
                        {'Origin': 'null'}, {'Sec-Fetch-Site': 'cross-site'}):
            with self.subTest(headers=headers):
                self.assertEqual(self.request(headers=headers)[0], 403)
        status, _, _ = self.request(headers={'Origin': f'http://127.0.0.1:{port}'})
        self.assertEqual(status, 200)
        self.assertEqual(MockProvider.requests, [])

    def test_static_sensitive_files_and_traversal(self):
        for path in ('/.git/config', '/%2egit/config', '/.env', '/env', '/../data.json',
                     '/%2e%2e/data.json', '/outside', '/hiddenlink/config', '/a\\..\\.git/config'):
            with self.subTest(path=path):
                self.assertIn(self.request('GET', path)[0], (403, 404))
        self.assertEqual(self.request('HEAD', '/.git/config')[0], 403)

    def test_start_uses_exact_bank_title_hides_answers_and_never_calls_provider(self):
        for config in (None, {}, {'apiKey': True}, self.config, dict(self.config, baseUrl='http://127.0.0.1:1/unreachable')):
            with self.subTest(config=config):
                body = {'questionIds': ['one'], 'question': 'client fake', 'referenceAnswer': 'client fake'}
                if config is not None:
                    body['config'] = config
                status, result, _ = self.request(body=body)
                self.assertEqual(status, 200, result)
                item = result['items'][0]
                self.assertEqual(set(item), {'id', 'sourceId', 'question'})
                self.assertEqual(item['question'], '  完整原题（保持原文）?  ')
                self.assertEqual(item['sourceId'], 'one')
                saved = self.service.tasks[item['id']]
                self.assertEqual(saved['source'], SOURCE)
                self.assertIsNot(saved['source'], self.service.questions['one'])
                for tail in REFERENCE_TAILS:
                    self.assertIn(tail, saved['referenceAnswer'])
                self.assertEqual(saved['rubric'], ['本题关键评分点', '本题必要边界'])
        self.assertEqual(MockProvider.requests, [])
        self.assertNotIn(self.config['apiKey'], str(self.service.tasks))
        self.assertNotIn('config', str(self.service.tasks))

    def test_start_snapshots_bank_and_returns_requested_order(self):
        status, result, _ = self.request(body={'questionIds': ['two', 'one']})
        self.assertEqual(status, 200)
        self.assertEqual([item['sourceId'] for item in result['items']], ['two', 'one'])
        self.assertEqual([item['question'] for item in result['items']], ['第二题原题', SOURCE['title']])
        task = self.service.tasks[result['items'][1]['id']]
        self.service.questions['one']['standardAnswer'].append('后来编辑内容')
        try:
            self.assertNotIn('后来编辑内容', task['referenceAnswer'])
            self.assertNotIn('后来编辑内容', task['source']['standardAnswer'])
        finally:
            self.service.questions['one']['standardAnswer'].pop()
        fallback = self.service.tasks[result['items'][0]['id']]['rubric']
        self.assertEqual(len(fallback), 4)
        self.assertFalse(any('本题关键评分点' in point for point in fallback))
        self.assertEqual(MockProvider.requests, [])

    def test_reference_has_no_truncation(self):
        original = self.service.questions['one']['standardAnswer'][:]
        self.service.questions['one']['standardAnswer'].append('长正文' * 40000 + '完整长文终点')
        try:
            task_id = self.start()
            self.assertIn('完整长文终点', self.service.tasks[task_id]['referenceAnswer'])
            self.assertGreater(len(self.service.tasks[task_id]['referenceAnswer']), 100000)
        finally:
            self.service.questions['one']['standardAnswer'] = original
        self.assertEqual(MockProvider.requests, [])

    def test_obsolete_generate_route_is_not_alias(self):
        self.assertEqual(self.request(path='/api/practice/generate')[0], 404)
        self.assertEqual(MockProvider.requests, [])
        self.assertEqual(self.service.tasks, {})

    def test_base_urls_normalize_and_configuration_rejections(self):
        base = f'http://127.0.0.1:{self.provider.server_port}'
        for suffix in ('', '/', '/v1', '/v1/', '/v1/chat/completions', '/chat/completions'):
            config = dict(self.config, baseUrl=base + suffix)
            self.assertTrue(backend.validate_config(config)[0].endswith('/chat/completions'))
        for url in ('file:///etc/passwd', 'https://user:pw@example.com/v1',
                    'https://example.com/v1?q=1', 'https://example.com/v1#secret',
                    'http://example.com/v1', 'https://example.com:bad', 'https://example.com\\oops'):
            with self.subTest(url=url), self.assertRaises(backend.APIError):
                backend.validate_config(dict(self.config, baseUrl=url))

    def test_grade_requires_configuration_and_answer_without_provider_call(self):
        task_id = self.start()
        for config in (None, {}, {'baseUrl': 'file:///etc/passwd', 'apiKey': 'fake', 'model': 'fake'}):
            status, _, _ = self.request(path='/api/practice/grade', body={
                'config': config, 'exerciseId': task_id, 'answer': '我的回答'})
            self.assertEqual(status, 400)
        for answer in ('', ' ', 'x' * 50001, False):
            self.assertEqual(self.grade(task_id, answer)[0], 400)
        self.assertIsNone(self.service.tasks[task_id]['result'])
        self.assertEqual(MockProvider.requests, [])

    def test_invalid_source_ids_no_call(self):
        for ids in ([], ['one', 'one'], ['other'], [True], ['one'] * 6):
            status, _, _ = self.request(body={'config': self.config, 'questionIds': ids})
            self.assertEqual(status, 400)
        self.assertEqual(MockProvider.requests, [])

    def test_task_limit_does_not_call_provider(self):
        original = backend.MAX_TASKS
        backend.MAX_TASKS = 1
        try:
            self.start()
            self.assertEqual(self.request()[0], 429)
        finally:
            backend.MAX_TASKS = original
        self.assertEqual(MockProvider.requests, [])

    def test_grade_uses_saved_task_computes_score_and_cache(self):
        task_id = self.start()
        MockProvider.output = copy.deepcopy(GRADE)
        MockProvider.output.update(score=0, mastery='low')
        status, result, _ = self.grade(task_id, referenceAnswer='client fake', rubric=['fake'], sourceId='two')
        self.assertEqual(status, 200)
        self.assertEqual((result['score'], result['mastery']), (89, 'high'))
        self.assertEqual(result['referenceAnswer'], self.service.tasks[task_id]['referenceAnswer'])
        for tail in REFERENCE_TAILS:
            self.assertIn(tail, result['referenceAnswer'])
        self.assertEqual(result['sourceId'], 'one')
        provider_task = json.loads(MockProvider.requests[-1]['body']['messages'][1]['content'].split('\n', 1)[1])['task']
        self.assertEqual(provider_task['referenceAnswer'], result['referenceAnswer'])
        self.assertEqual(provider_task['question'], SOURCE['title'])
        self.assertEqual(provider_task['source'], SOURCE)
        self.assertNotIn('client fake', str(provider_task))
        self.assertEqual(provider_task['rubric'], ['本题关键评分点', '本题必要边界'])
        self.assertEqual(len(MockProvider.requests), 1)
        request = MockProvider.requests[0]
        self.assertEqual(request['path'], '/v1/chat/completions')
        self.assertFalse(request['body']['stream'])
        self.assertIn('不可信', request['body']['messages'][1]['content'])
        self.assertIn('完整标准回答末段', str(provider_task))
        calls = len(MockProvider.requests)
        self.assertEqual(self.grade(task_id)[1], result)
        self.assertEqual(self.grade(task_id, '另一个回答')[0], 409)
        self.assertEqual(len(MockProvider.requests), calls)
        self.assertEqual(self.grade('other-task')[0], 404)
        self.assertEqual(len(MockProvider.requests), calls)

    def test_score_boundaries_and_critical_cap(self):
        for score, mastery in ((0, 'low'), (59, 'low'), (60, 'medium'), (84, 'medium'), (85, 'high'), (100, 'high')):
            task_id = self.start()
            MockProvider.output = copy.deepcopy(GRADE)
            remaining = score
            for name, maximum in backend.DIMENSIONS.items():
                MockProvider.output['dimensions'][name] = min(maximum, remaining)
                remaining -= min(maximum, remaining)
            status, result, _ = self.grade(task_id)
            self.assertEqual((status, result['score'], result['mastery']), (200, score, mastery))
            MockProvider.output = copy.deepcopy(GRADE)
        task_id = self.start()
        MockProvider.output = copy.deepcopy(GRADE)
        MockProvider.output['criticalMisunderstanding'] = True
        _, result, _ = self.grade(task_id)
        self.assertEqual((result['score'], result['mastery']), (59, 'low'))
        self.assertEqual(sum(result['dimensions'].values()), 59)
        self.assertIn('59', result['feedback'])

    def test_bad_grade_is_retryable_and_never_cached(self):
        task_id = self.start()
        bad_values = (True, -1, 41, 1.5, '30', None)
        for bad in bad_values:
            MockProvider.output = copy.deepcopy(GRADE)
            MockProvider.output['dimensions']['correctness'] = bad
            self.assertEqual(self.grade(task_id)[0], 502)
            self.assertIsNone(self.service.tasks[task_id]['result'])
            self.assertFalse(self.service.tasks[task_id]['busy'])
        for field, value in (('criticalMisunderstanding', 'false'), ('strengths', 'great'), ('suggestedAnswer', '')):
            MockProvider.output = copy.deepcopy(GRADE)
            MockProvider.output[field] = value
            self.assertEqual(self.grade(task_id)[0], 502)
        MockProvider.output = copy.deepcopy(GRADE)
        del MockProvider.output['criticalMisunderstanding']
        self.assertEqual(self.grade(task_id)[0], 502)
        MockProvider.output = copy.deepcopy(GRADE)
        self.assertEqual(self.grade(task_id)[0], 200)

    def test_malformed_refusal_truncation_status_and_redaction(self):
        task_id = self.start()
        for raw in (b'not json', b'{"choices":[]}', b'{"choices":null}', b'{"choices":[null]}', b'{"choices":[{"message":null,"finish_reason":"stop"}]}', b'null'):
            MockProvider.raw = raw
            self.assertEqual(self.grade(task_id)[0], 502)
        MockProvider.raw = None
        for finish in ('length', 'content_filter', None):
            MockProvider.finish_reason = finish
            self.assertEqual(self.grade(task_id)[0], 502)
        MockProvider.finish_reason = 'stop'
        MockProvider.refusal = 'fake-key-only-DoNotLeak refusal'
        self.assertEqual(self.grade(task_id)[0], 502)
        MockProvider.refusal = None
        for status in (401, 403, 429, 500):
            MockProvider.status = status
            MockProvider.raw = self.config['apiKey'].encode()
            code, result, _ = self.grade(task_id)
            self.assertEqual(code, 502)
            self.assertNotIn(self.config['apiKey'], json.dumps(result))
        MockProvider.status, MockProvider.raw = 200, None
        MockProvider.output = copy.deepcopy(GRADE)
        MockProvider.output['feedback'] = '反馈 ' + self.config['apiKey']
        status, result, _ = self.grade(task_id)
        self.assertEqual(status, 200)
        self.assertIn('[已隐藏]', result['feedback'])
        self.assertNotIn(self.config['apiKey'], json.dumps(result))
        self.assertNotIn(self.config['apiKey'], str(self.service.tasks))

    def test_no_redirect_and_timeout(self):
        task_id = self.start()
        MockProvider.status = 307
        MockProvider.redirect = f'http://127.0.0.1:{self.provider.server_port}/credential-steal'
        status, result, _ = self.grade(task_id)
        self.assertEqual(status, 502)
        self.assertIn('重定向', result['error'])
        self.assertEqual(len(MockProvider.requests), 1)
        MockProvider.status, MockProvider.redirect, MockProvider.delay = 200, None, .35
        status, result, _ = self.grade(task_id)
        self.assertEqual(status, 504)
        self.assertNotIn(self.config['apiKey'], str(result))
        time.sleep(.4)

    def test_limits_json_and_concurrency(self):
        self.assertEqual(self.request(raw=b'x' * (128 * 1024 + 1))[0], 413)
        for raw in (b'[]', b'{', b'{"config":NaN}', b'{"config":{},"config":{}}'):
            self.assertEqual(self.request(raw=raw)[0], 400)
        self.assertEqual(self.request(headers={'Content-Type': 'text/plain'})[0], 415)
        for _ in range(4):
            self.service.slots.acquire()
        try:
            self.assertEqual(self.request()[0], 429)
        finally:
            for _ in range(4):
                self.service.slots.release()
        self.assertEqual(MockProvider.requests, [])

    def test_expired_and_busy_tasks(self):
        task_id = self.start()
        self.service.tasks[task_id]['busy'] = True
        self.assertEqual(self.grade(task_id)[0], 409)
        self.service.tasks[task_id]['busy'] = False
        self.service.tasks[task_id]['expires'] = time.time() - 1
        self.assertEqual(self.grade(task_id)[0], 404)
        self.assertEqual(MockProvider.requests, [])

    def test_no_logs_contain_provider_or_credentials(self):
        task_id = self.start()
        output = io.StringIO()
        MockProvider.status = 401
        MockProvider.raw = b'fake-key-only-DoNotLeak provider internal response'
        with contextlib.redirect_stderr(output), contextlib.redirect_stdout(output):
            self.grade(task_id)
        self.assertEqual(output.getvalue(), '')


if __name__ == '__main__':
    unittest.main()
