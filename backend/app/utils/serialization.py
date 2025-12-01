from typing import Any

from bson import ObjectId


def convert_object_ids(obj: Any) -> Any:
    if isinstance(obj, ObjectId):
        return str(obj)
    if isinstance(obj, list):
        return [convert_object_ids(item) for item in obj]
    if isinstance(obj, dict):
        return {key: convert_object_ids(value) for key, value in obj.items()}
    return obj