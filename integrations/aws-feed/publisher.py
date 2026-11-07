"""Publish only an explicitly fictional, validated snapshot, never a workspace backup."""
import hashlib
import json
import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

import boto3
from botocore.exceptions import ClientError


def validate(feed):
    if not isinstance(feed, dict) or set(feed) != {"schemaVersion", "fictional", "anchorDate", "timeZone", "events", "tasks"}:
        raise ValueError("Expected public feed fields only")
    if feed["schemaVersion"] != 1 or feed["fictional"] is not True:
        raise ValueError("Only fictional version 1 feeds may be published")
    date.fromisoformat(feed["anchorDate"])
    ZoneInfo(feed["timeZone"])
    for kind in ("events", "tasks"):
        rows = feed[kind]
        if not isinstance(rows, list) or len(rows) > 500:
            raise ValueError("Too many rows")
        ids = set()
        for row in rows:
            allowed = {"id", "title", "start", "end", "location"} if kind == "events" else {"id", "title", "dueAt", "dueDate", "status", "archived"}
            if not isinstance(row, dict) or set(row) - allowed or not {"id", "title"} <= set(row):
                raise ValueError("Invalid public row")
            for key, value in row.items():
                if key == "archived":
                    if type(value) is not bool:
                        raise ValueError("Invalid archived flag")
                elif not isinstance(value, str) or not 1 <= len(value) <= 240:
                    raise ValueError("Invalid text")
            if row["id"] in ids:
                raise ValueError("Duplicate ID")
            ids.add(row["id"])
            if "dueDate" in row:
                date.fromisoformat(row["dueDate"])
            for key in ("start", "end", "dueAt"):
                if key in row and datetime.fromisoformat(row[key].replace("Z", "+00:00")).tzinfo is None:
                    raise ValueError("Timezone required")
            if kind == "events" and (not {"start", "end"} <= set(row) or datetime.fromisoformat(row["end"].replace("Z", "+00:00")) <= datetime.fromisoformat(row["start"].replace("Z", "+00:00"))):
                raise ValueError("Invalid event interval")
    return feed


def publish(feed, s3, bucket):
    body = json.dumps(validate(feed), sort_keys=True, separators=(",", ":")).encode()
    if len(body) > 512_000:
        raise ValueError("Feed too large")
    digest = hashlib.sha256(body).hexdigest()
    # Prefix-scoped listing distinguishes an absent object from a denied read.
    exists = s3.list_objects_v2(Bucket=bucket, Prefix="demo/today.json", MaxKeys=1).get("Contents", [])
    try:
        previous = s3.head_object(Bucket=bucket, Key="demo/today.json") if any(row["Key"] == "demo/today.json" for row in exists) else {}
        if previous.get("Metadata", {}).get("sha256") == digest:
            return {"changed": False, "sha256": digest}
    except ClientError as error:
        if error.response["Error"]["Code"] not in ("404", "NoSuchKey"):
            raise
    s3.put_object(Bucket=bucket, Key="demo/today.json", Body=body, ContentType="application/json", ServerSideEncryption="AES256", Metadata={"sha256": digest})
    return {"changed": True, "sha256": digest}


def handler(event, _context):
    return publish(event["feed"], boto3.client("s3"), os.environ["DEMO_BUCKET"])
