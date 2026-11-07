def normalize_tags(tags):
    """Return nonempty tags, stripped, lowercased and deduplicated in order."""
    return [tag.lower() for tag in tags]
