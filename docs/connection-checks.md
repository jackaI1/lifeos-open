# Repeating browser and deployment checks

I use `make install`, `make lint`, `make test`, `make build` and `make docker` for
the normal workspace. `make help` explains each command. Real file and directory
inputs invalidate the build stamp, and missing output files force a rebuild.
CI runs `node tools/test-make.mjs`, which runs `make test` and verifies that the
second unchanged build does not change the stamp. Docker needs another machine
with a container runtime; this work did not start a VM on the Mac.

## Browser and data checks

Install .NET 8, Chrome, Node 24 and the locked Node dependencies. In one terminal,
start a fictional workspace with `npm run dev`; then:

```sh
dotnet test test/selenium --logger "nunit;LogFilePath=$PWD/test-results/selenium/nunit.xml"
```

`LIFEOS_TEST_URL` can select another disposable local instance. Do not point
mutation tests at a personal workspace. Selenium WebDriver drives headless
Chrome, and NUnit is the C# test runner. A page object holds selectors and
explicit waits, conditions such as a saved dialog closing, instead of fixed
sleeps. The tests load the schedule, add and edit an event, reload it, compare
its saved date, compare every displayed schedule title/time and the total row
count against the API, and verify that an HTML-looking title stays literal
text. The browser quits in teardown and captures a screenshot on failure.
GitHub Actions runs on every push and pull request and uploads NUnit XML.

The [security checks](../SECURITY-TESTING.md) also run an OWASP ZAP passive scan
of a local public build. All new medium and high findings fail CI.

## A disposable container managed by Terraform

```sh
docker build --target public-demo -t lifeos-public:terraform .
terraform -chdir=infra/docker init
terraform -chdir=infra/docker fmt -check
terraform -chdir=infra/docker validate
terraform -chdir=infra/docker plan -out=demo.tfplan
terraform -chdir=infra/docker apply demo.tfplan
curl http://127.0.0.1:18080/healthz
terraform -chdir=infra/docker destroy
```

The module provisions the real public-demo container through the Docker
provider. `image` selects an existing local image, `port` defaults to 18080 and
`name` identifies the owned container. Outputs give its URL and exact container
id. It binds only to loopback, uses a read-only filesystem, drops capabilities
and disallows privilege escalation. CI applies the plan, checks the actual health
response, destroys it in an exit trap and verifies the container is gone.

## AWS options

The existing [AWS container guide](deploy-aws.md) and `tools/deploy-aws.mjs`
prepare a public-demo image for ECS, AWS's container service. The Docker workflow
runs the tests inside the build image, checks runtime health and persistence,
scans the image and publishes successful main builds and release tags to GHCR.
The public `/healthz` endpoint and standalone `/api/health` emit structured JSON with time, service, event,
HTTP status and success. ECS's `awslogs` driver sends stdout to CloudWatch. The
Terraform module now defines a log metric for `health_check` entries with
HTTP status 500 or higher and an alarm for three such failures within five
minutes. It uses the [numeric JSON filter syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/FilterAndPatternSyntax.html) supported by CloudWatch. Configure alarm notifications in your AWS account.
A failed network probe that cannot reach the app cannot produce an app log;
ECS and load-balancer health checks remain necessary.

For an optional public snapshot publisher:

```sh
terraform -chdir=infra/publisher init
terraform -chdir=infra/publisher apply -var bucket_name=your-unique-fictional-feed
# Put {"feed": <the contents of public/demo/today.json>} in a local event.json.
aws lambda invoke --function-name lifeos-demo-publisher --cli-binary-format raw-in-base64-out --payload file://event.json response.json
```

The Python Lambda validates the complete allowlist of public feed fields before
writing `demo/today.json` in a private encrypted S3 bucket. Its IAM role can list
only that exact prefix and read/write only that key, plus its log stream and
its own encryption key. Uploads inherit the bucket’s customer-managed encryption
key; the publisher does not override that default. It
rejects private or malformed feeds and compares a content digest before writing
an unchanged feed again. Moto tests make real boto3 calls to emulated S3 and
explicitly enable IAM checks for permission-denial coverage. The bucket stays
private; use an authenticated reader or a separately configured distribution.
There is no public function URL. A real account needs an operator allowed to
create these resources and invoke the function.

These optional stacks have not been deployed to a real AWS account. S3 charges
for stored bytes and requests; Lambda charges for requests and execution;
CloudWatch charges for logs and alarms, and ECS/EC2 adds compute/network costs.
Small fictional examples may fit an account's free allowance, but it is not a
promise of zero cost. I check current [S3 pricing](https://aws.amazon.com/s3/pricing/),
[Lambda pricing](https://aws.amazon.com/lambda/pricing/) and
[CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/) before applying.
Each new S3 module creates one customer-managed encryption key. AWS currently
lists a base US$1 per key per month, plus request and rotation charges
([KMS pricing](https://aws.amazon.com/kms/pricing/), checked November 6, 2026).
Empty the example bucket before destroying the publisher stack. Keep credentials
in the AWS CLI environment or an operator role, never a committed file.
