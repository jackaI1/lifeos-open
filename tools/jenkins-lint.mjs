import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export async function jenkinsClient({url, user, token}) {
  if (!user || !token) throw Error('Jenkins credentials are required: JENKINS_USER and JENKINS_TOKEN.');
  const base = new URL(`${url.replace(/\/$/, '')}/`);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) {
    throw Error('Use HTTPS for Jenkins credentials outside localhost.');
  }
  const authorization = `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
  const request = (path, options = {}) => fetch(new URL(path, base), {
    ...options, redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: {authorization, ...options.headers},
  });
  const crumbResponse = await request('crumbIssuer/api/json');
  if (!crumbResponse.ok) throw Error(`Jenkins crumb request failed (HTTP ${crumbResponse.status}).`);
  const crumb = await crumbResponse.json();
  if (typeof crumb.crumbRequestField !== 'string' || !crumb.crumbRequestField || typeof crumb.crumb !== 'string' || !crumb.crumb) {
    throw Error('Jenkins returned invalid crumb data.');
  }
  const cookie = crumbResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  return (path, options = {}) => request(path, {
    ...options,
    headers: {[crumb.crumbRequestField]: crumb.crumb, ...(cookie ? {cookie} : {}), ...options.headers},
  });
}

// The official endpoint returns HTTP 200 for both valid and invalid pipelines.
export async function validateJenkinsfile({url, user, token, jenkinsfile}) {
  const request = await jenkinsClient({url, user, token});
  const response = await request('pipeline-model-converter/validate', {
    method: 'POST',
    body: new URLSearchParams({jenkinsfile}),
  });
  if (!response.ok) throw Error(`Jenkins validation failed (HTTP ${response.status}).`);
  const message = (await response.text()).trim();
  if (message !== 'Jenkinsfile successfully validated.') {
    // Do not echo server responses: invalid-source diagnostics can contain source secrets.
    throw Error('Jenkins rejected the pipeline or returned an unexpected validation response.');
  }
  return message;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const message = await validateJenkinsfile({
      url: process.env.JENKINS_URL || 'http://127.0.0.1:8081',
      user: process.env.JENKINS_USER || 'admin',
      token: process.env.JENKINS_TOKEN || process.env.JENKINS_ADMIN_PASSWORD,
      jenkinsfile: await readFile(process.argv[2] || 'Jenkinsfile', 'utf8'),
    });
    console.log(message);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
