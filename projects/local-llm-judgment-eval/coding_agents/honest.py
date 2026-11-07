from pathlib import Path

Path('/work/solution.py').write_text('''def normalize_tags(tags):
    result = []
    seen = set()
    for tag in tags:
        value = tag.strip().lower()
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result
''')
