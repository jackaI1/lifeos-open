"""Reject every new medium/high passive finding, retaining a narrow reviewed baseline."""
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text())
known = json.loads(Path('security/zap-baseline.json').read_text())
failures = []
for site in report['site']:
    for alert in site.get('alerts', []):
        if int(alert['riskcode']) < 2:
            continue
        instances = alert.get('instances', []) or [{}]
        for instance in instances:
            if not any(alert['alertRef'] == item['alertRef'] and instance.get('evidence', '') == item['evidence'] for item in known):
                failures.append({'rule': alert['alertRef'], 'name': alert['name'], 'evidence': instance.get('evidence', '')[:300]})
print(json.dumps({'new_medium_or_high': failures}, indent=2))
if failures:
    sys.exit(1)
