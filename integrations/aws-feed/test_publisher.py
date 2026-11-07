import json
from pathlib import Path

import boto3
import pytest
from botocore.exceptions import ClientError
from moto import mock_aws
from moto.core import set_initial_no_auth_action_count
from publisher import publish

FEED = json.loads((Path(__file__).parents[2] / "public/demo/today.json").read_text())


@pytest.mark.parametrize("encryption", ["AES256", "aws:kms"])
@mock_aws
def test_real_s3_calls_are_idempotent_and_encrypted(encryption):
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket="fictional-lifeos")
    rule = {"SSEAlgorithm": encryption}
    if encryption == "aws:kms":
        rule["KMSMasterKeyID"] = boto3.client("kms", region_name="us-east-1").create_key(Description="Fictional feed test")["KeyMetadata"]["Arn"]
    s3.put_bucket_encryption(Bucket="fictional-lifeos", ServerSideEncryptionConfiguration={"Rules": [{"ApplyServerSideEncryptionByDefault": rule}]})
    assert publish(FEED, s3, "fictional-lifeos")["changed"]
    assert not publish(FEED, s3, "fictional-lifeos")["changed"]
    obj = s3.get_object(Bucket="fictional-lifeos", Key="demo/today.json")
    assert obj["ServerSideEncryption"] == encryption
    if encryption == "aws:kms":
        assert obj["SSEKMSKeyId"] == rule["KMSMasterKeyID"]
    assert json.loads(obj["Body"].read()) == FEED


@mock_aws
def test_malformed_or_private_feed_does_not_write():
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket="fictional-lifeos")
    for bad in ({**FEED, "schemaVersion": True}, {**FEED, "anchorDate": "20261106"}, {**FEED,"tasks":[{"id":"bad","title":"   "}]}, {**FEED,"events":[{"id":"bad","title":"bad","start":"2026-11-06 10:00:00Z","end":"2026-11-06 11:00:00Z"}]}, {**FEED, "fictional": False}, {**FEED, "privateNotes": "never publish"}, {**FEED, "events": [{"id": "a", "title": "a", "start": "bad", "end": "bad"}]}):
        with pytest.raises((ValueError, KeyError)):
            publish(bad, s3, "fictional-lifeos")
    assert s3.list_objects_v2(Bucket="fictional-lifeos")["KeyCount"] == 0


@mock_aws
def test_iam_denies_unprivileged_publisher():
    root = boto3.client("s3", region_name="us-east-1")
    root.create_bucket(Bucket="fictional-lifeos")
    iam = boto3.client("iam", region_name="us-east-1")
    iam.create_user(UserName="no-permissions")
    key = iam.create_access_key(UserName="no-permissions")["AccessKey"]
    denied = boto3.client("s3", region_name="us-east-1", aws_access_key_id=key["AccessKeyId"], aws_secret_access_key=key["SecretAccessKey"])

    @set_initial_no_auth_action_count(0)
    def enforce():
        with pytest.raises(ClientError) as error:
            publish(FEED, denied, "fictional-lifeos")
        assert error.value.response["Error"]["Code"] in ("AccessDenied", "403")
    enforce()
