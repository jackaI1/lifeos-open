"""Exercise S3 event -> actual Go Lambda -> DynamoDB + S3 quarantine on LocalStack."""
import json
import os
from pathlib import Path
import time
import zipfile

import boto3

ENDPOINT = os.environ.get('AWS_ENDPOINT_URL', 'http://127.0.0.1:4566')
clients = {name: boto3.client(name, endpoint_url=ENDPOINT, region_name='us-east-1', aws_access_key_id='test', aws_secret_access_key='test') for name in ('s3', 'lambda', 'dynamodb', 'iam')}
s3, function, db, iam = [clients[name] for name in ('s3', 'lambda', 'dynamodb', 'iam')]


def until(check, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(0.5)
    raise AssertionError('LocalStack pipeline did not finish')


def main():
    raw, rejects, table, name = 'lifeos-fhir-raw', 'lifeos-fhir-rejects', 'lifeos-fhir', 'lifeos-fhir-ingest'
    try:
        for bucket in (raw, rejects):
            s3.create_bucket(Bucket=bucket)
        db.create_table(TableName=table, BillingMode='PAY_PER_REQUEST', AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'}], KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}])
        role = iam.create_role(RoleName=name, AssumeRolePolicyDocument=json.dumps({'Version': '2012-10-17', 'Statement': [{'Effect': 'Allow', 'Principal': {'Service': 'lambda.amazonaws.com'}, 'Action': 'sts:AssumeRole'}]}))['Role']['Arn']
        with zipfile.ZipFile('function.zip', 'w') as archive:
            archive.write('bootstrap', 'bootstrap')
        function.create_function(FunctionName=name, Role=role, Runtime='provided.al2023', Handler='bootstrap', Timeout=30, MemorySize=128, Code={'ZipFile': Path('function.zip').read_bytes()}, Environment={'Variables': {'RAW_BUCKET': raw, 'REJECT_BUCKET': rejects, 'FHIR_TABLE': table, 'AWS_ENDPOINT_URL': 'http://localstack:4566'}})
        until(lambda: function.get_function_configuration(FunctionName=name)['State'] == 'Active')
        arn = function.get_function_configuration(FunctionName=name)['FunctionArn']
        function.add_permission(FunctionName=name, StatementId='s3', Action='lambda:InvokeFunction', Principal='s3.amazonaws.com', SourceArn='arn:aws:s3:::' + raw)
        s3.put_bucket_notification_configuration(Bucket=raw, NotificationConfiguration={'LambdaFunctionConfigurations': [{'LambdaFunctionArn': arn, 'Events': ['s3:ObjectCreated:*'], 'Filter': {'Key': {'FilterRules': [{'Name': 'prefix', 'Value': 'raw/'}]}}}]})
        body = Path('fixtures/bundle.json').read_bytes()
        s3.put_object(Bucket=raw, Key='raw/sample.json', Body=body)
        until(lambda: db.scan(TableName=table)['Count'] == 2)
        until(lambda: s3.list_objects_v2(Bucket=rejects).get('KeyCount', 0) == 1)
        # The S3 event integration invokes the function again on the same contents.
        s3.put_object(Bucket=raw, Key='raw/sample.json', Body=body)
        # Synchronous duplicate guarantees completion before checking idempotency.
        event={'Records':[{'s3':{'bucket':{'name':raw},'object':{'key':'raw/sample.json'}}}]}
        response=function.invoke(FunctionName=name,Payload=json.dumps(event).encode())
        assert 'FunctionError' not in response, response['Payload'].read()
        assert db.scan(TableName=table)['Count'] == 2
        s3.put_object(Bucket=raw, Key='raw/malformed.json', Body=b'{')
        objects=until(lambda: s3.list_objects_v2(Bucket=rejects).get('Contents', []) if s3.list_objects_v2(Bucket=rejects).get('KeyCount', 0) == 2 else None)
        quarantine=[json.loads(s3.get_object(Bucket=rejects,Key=obj['Key'])['Body'].read()) for obj in objects]
        assert any('invalid JSON' in row['reason'] and row['sourcePath'].endswith('malformed.json') for group in quarantine for row in group)
        assert db.scan(TableName=table)['Count'] == 2
        print('Real Go Lambda: two normalized records, duplicate skipped, two quarantine objects, malformed bundle isolated.')
    finally:
        try:
            s3.put_bucket_notification_configuration(Bucket=raw,NotificationConfiguration={})
            function.delete_function(FunctionName=name)
            db.delete_table(TableName=table)
            iam.delete_role(RoleName=name)
        finally:
            for bucket in (raw, rejects):
                for obj in s3.list_objects_v2(Bucket=bucket).get('Contents',[]):
                    s3.delete_object(Bucket=bucket,Key=obj['Key'])
                s3.delete_bucket(Bucket=bucket)

if __name__ == '__main__':
    main()
