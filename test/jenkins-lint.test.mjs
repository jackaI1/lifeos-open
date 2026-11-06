import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {validateJenkinsfile} from '../tools/jenkins-lint.mjs';

async function withJenkins(handler, run) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const credentials = {user: 'fictional-admin', token: 'fictional-password'};
test('linter sends the Jenkinsfile with the authenticated crumb and its session cookie', async () => {
  await withJenkins(async (req, res) => {
    assert.equal(req.headers.authorization, `Basic ${Buffer.from('fictional-admin:fictional-password').toString('base64')}`);
    if (req.url === '/crumbIssuer/api/json') {
      res.setHeader('Set-Cookie', 'JSESSIONID=fixture; Path=/; HttpOnly');
      res.end(JSON.stringify({crumbRequestField: 'Jenkins-Crumb', crumb: 'fixture-crumb'}));
      return;
    }
    assert.equal(req.url, '/pipeline-model-converter/validate');
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.cookie, 'JSESSIONID=fixture');
    assert.equal(req.headers['jenkins-crumb'], 'fixture-crumb');
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.equal(new URLSearchParams(body).get('jenkinsfile'), 'pipeline { agent any }');
    res.end('Jenkinsfile successfully validated.\n');
  }, async url => {
    assert.match(await validateJenkinsfile({...credentials, url, jenkinsfile: 'pipeline { agent any }'}), /successfully validated/);
  });
});

for (const [name, response, status] of [
  ['invalid pipeline even with HTTP 200', 'Errors encountered validating Jenkinsfile:\nMissing stages', 200],
  ['login HTML instead of a validation result', '<html>Sign in</html>', 200],
  ['permission denied', 'Forbidden', 403],
]) {
  test(`linter rejects ${name}`, async () => {
    await withJenkins((req, res) => {
      if (req.url === '/crumbIssuer/api/json') {
        res.end(JSON.stringify({crumbRequestField: 'Jenkins-Crumb', crumb: 'fixture'}));
      } else {
        res.statusCode = status;
        res.end(response);
      }
    }, async url => {
      await assert.rejects(validateJenkinsfile({...credentials, url, jenkinsfile: 'broken'}));
    });
  });
}

test('linter stops on failed crumb authentication without submitting source', async () => {
  let calls = 0;
  await withJenkins((req, res) => {
    calls++;
    res.statusCode = 401;
    res.end('Unauthorized');
  }, async url => {
    await assert.rejects(validateJenkinsfile({...credentials, url, jenkinsfile: 'pipeline {}'}), /401/);
    assert.equal(calls, 1);
  });
});

test('linter rejects malformed crumb data before submitting source', async () => {
  await withJenkins((req, res) => res.end('{}'), async url => {
    await assert.rejects(validateJenkinsfile({...credentials, url, jenkinsfile: 'pipeline {}'}), /crumb/i);
  });
});

test('linter requires credentials and protects credentials on non-local HTTP', async () => {
  await assert.rejects(validateJenkinsfile({url: 'http://127.0.0.1:1', jenkinsfile: 'pipeline {}'}), /credentials/i);
  await assert.rejects(validateJenkinsfile({...credentials, url: 'http://jenkins.example.invalid', jenkinsfile: 'pipeline {}'}), /HTTPS/);
});

test('linter reports an unreachable server', async () => {
  await assert.rejects(validateJenkinsfile({...credentials, url: 'http://127.0.0.1:1', jenkinsfile: 'pipeline {}'}));
});
