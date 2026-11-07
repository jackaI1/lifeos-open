"""Create real Budibase tables, review screens and an audit automation, using v3.50 APIs."""
import json
import os
import sqlite3
from pathlib import Path
import uuid

import requests

ORIGIN = os.environ.get('BUDIBASE_URL', 'http://127.0.0.1:10000')
session = requests.Session()


def call(path, method='GET', body=None):
    response = session.request(method, ORIGIN + path, json=body, timeout=60)
    if not response.ok:
        raise RuntimeError(f'Budibase {method} {path}: HTTP {response.status_code}; {response.text[:160]}')
    return response.json() if response.content else None


def component(kind, **props):
    return {'_id': str(uuid.uuid4()), '_component': '@budibase/standard-components/' + kind, '_styles': {'normal': {}, 'hover': {}, 'active': {}, 'selected': {}}, '_children': [], **props}


def main():
    call('/api/global/auth/default/login', 'POST', {'username': os.environ['BB_ADMIN_USER_EMAIL'], 'password': os.environ['BB_ADMIN_USER_PASSWORD']})
    me = call('/api/global/self')
    session.headers['x-csrf-token'] = me['csrfToken']
    session.headers['x-budibase-api-key'] = call('/api/global/self/api_key')['apiKey']
    app = call('/api/public/v1/applications', 'POST', {'name': 'LifeOS fictional review desk', 'url': '/lifeos-review'})['data']
    app_id = app.get('appId') or app['_id']
    session.headers['x-budibase-app-id'] = app_id
    tables = {}
    schemas = {
        'Deliverables': {'Title': {'type': 'string', 'constraints': {'presence': True}}, 'Status': {'type': 'options', 'constraints': {'inclusion': ['draft', 'review', 'approved']}}, 'Cleanup': {'type': 'boolean'}},
        'Audit': {'Title': {'type': 'string'}, 'Status': {'type': 'string'}, 'SourceRow': {'type': 'string'}},
        'Assets': {'Tag': {'type':'string'}, 'Network': {'type':'string'}, 'Year': {'type':'number'}, 'Condition': {'type':'number'}, 'Inspected': {'type':'string'}},
        'FieldCitations': {'Field': {'type': 'string'}, 'Value': {'type': 'string'}, 'Source': {'type': 'string'}}
    }
    for name, schema in schemas.items():
        tables[name] = call('/api/public/v1/tables', 'POST', {'name': name, 'primaryDisplay': next(iter(schema)), 'schema': {key: {**value, 'name': key} for key, value in schema.items()}})['data']['_id']
    row = call(f"/api/public/v1/tables/{tables['Deliverables']}/rows", 'POST', {'Title': 'Fictional desk node design', 'Status': 'draft', 'Cleanup': True})['data']
    field_map = json.loads(Path('samples/forms/field-map.json').read_text())
    for citation in field_map['citations']:
        call(f"/api/public/v1/tables/{tables['FieldCitations']}/rows", 'POST', {'Field': citation['field'], 'Value': str(citation['value']), 'Source': citation['source']})
    cleanup = call('/api/public/v1/views', 'POST', {'name':'Cleanup queue','tableId':tables['Deliverables'],'schema':{key:{**value,'name':key} for key,value in schemas['Deliverables'].items()},'query':{'logicalOperator':'all','groups':[{'logicalOperator':'all','filters':[{'field':'Cleanup','operator':'equal','value':True},{'field':'Status','operator':'notEqual','value':'approved'}]}]}})['data']
    registry = sqlite3.connect(':memory:')
    try:
        registry.row_factory = sqlite3.Row
        registry.executescript(Path('tools/internal-desk/schema.sql').read_text())
        for asset in registry.execute('SELECT * FROM asset_inspection_report ORDER BY tag'):
            call(f"/api/public/v1/tables/{tables['Assets']}/rows", 'POST', {'Tag':asset['tag'],'Network':asset['network'],'Year':asset['installed_year'],'Condition':asset['condition_score'],'Inspected':asset['last_inspected']})
    finally:
        registry.close()
    workspace_apps = call('/api/workspaceApp')
    workspace_app = (workspace_apps if isinstance(workspace_apps, list) else workspace_apps.get('workspaceApps', workspace_apps.get('data', [])))[0]
    workspace_id = workspace_app['_id']
    screens = []
    for name, route, children in [
        ('Review deliverable', '/review/:id', [component('formblock', dataSource={'type': 'table', 'tableId': tables['Deliverables'], 'resourceId': tables['Deliverables'], 'label':'Deliverables'}, actionType='Update', rowId='{{ url.id }}', title='Review fictional deliverable', buttonPosition='bottom', showSaveButton=True, saveButtonLabel='Save review', showDeleteButton=False)]),
        ('Cleanup queue', '/cleanup', [component('gridblock',table={**cleanup,'type':'viewV2','resourceId':cleanup['id'],'label':'Cleanup queue'},allowAddRows=False,allowEditRows=False,allowDeleteRows=False)]),
        ('Audit log', '/audit', [component('gridblock', table={'type': 'table', 'tableId': tables['Audit']}, allowAddRows=False, allowEditRows=False, allowDeleteRows=False)]),
        ('Asset inspection report', '/assets', [component('gridblock', table={'type':'table','tableId':tables['Assets'],'label':'Asset inspection report'},allowAddRows=False,allowEditRows=False,allowDeleteRows=False)]),
        ('Source citations', '/citations', [component('gridblock', table={'type': 'table', 'tableId': tables['FieldCitations']}, allowAddRows=False, allowEditRows=False, allowDeleteRows=False)])
    ]:
        screens.append(call('/api/screens', 'POST', {'name': name, 'workspaceAppId': workspace_id, 'showNavigation': True, 'width': 'Large', 'routing': {'route': route, 'roleId': 'BASIC', 'homeScreen': False}, 'props': component('container', layout='flex', direction='column', hAlign='stretch', vAlign='top', size='grow', gap='M', _children=children)}))
    definitions = call('/api/automations/definitions/list')
    trigger_key, trigger = next((key, value) for key, value in definitions['trigger'].items() if 'row' in value['name'].lower() and 'updated' in value['name'].lower())
    action_key, action = next((key, value) for key, value in definitions['action'].items() if 'create row' in value['name'].lower())
    automation = call('/api/automations', 'POST', {'name': 'Record every deliverable review', 'type': 'automation', 'definition': {'trigger': {**trigger, 'id': str(uuid.uuid4()), 'stepId': trigger_key, 'inputs': {'tableId': tables['Deliverables']}}, 'steps': [{**action, 'id': str(uuid.uuid4()), 'stepId': action_key, 'inputs': {'row': {'tableId': tables['Audit'], 'Title': '{{trigger.row.Title}}', 'Status': '{{trigger.row.Status}}', 'SourceRow': '{{trigger.id}}'}}}]}})
    deployment = call(f'/api/public/v1/applications/{app_id}/publish', 'POST')['data']
    state = {'appId': app_id, 'productionId': app_id.replace('app_dev_', 'app_'), 'workspaceAppId': workspace_id, 'tables': tables, 'rowId': row['_id'], 'appUrl': deployment.get('appUrl', '/app/lifeos-review'), 'cleanupView':cleanup['id'], 'screens': len(screens), 'automation': automation.get('automation', automation).get('_id')}
    Path('.runtime/internal-desk').mkdir(parents=True, exist_ok=True)
    Path('.runtime/internal-desk/budibase.json').write_text(json.dumps(state, indent=2))
    # No API key or session cookie is written to disk or stdout.
    print('Created real Budibase review form, audit automation, source-citation view and fictional row.')


if __name__ == '__main__':
    main()
