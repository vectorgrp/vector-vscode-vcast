from autoreq.cache import JSONCache


from pydantic import BaseModel
from pydantic._internal._model_construction import ModelMetaclass


import hashlib
import json

from autoreq.test_generation.schema_builder import create_schema_instance_mock


class RequestCache(JSONCache):
    def __init__(self, cache_dir: str = None):
        super().__init__(cache_dir)

    def input_hash(self, inputs):
        serializable_inputs = self._make_json_serializable(inputs)
        input_str = json.dumps(serializable_inputs, sort_keys=True, indent=4)
        return hashlib.sha256(input_str.encode()).hexdigest()

    def _make_json_serializable(self, obj):
        if isinstance(obj, BaseModel):
            return self._make_json_serializable(obj.model_dump(mode='json'))
        if isinstance(obj, ModelMetaclass):
            return self._normalize_schema_names(
                self._make_json_serializable(obj.schema())
            )
        elif isinstance(obj, (list, tuple)):
            return [self._make_json_serializable(item) for item in obj]
        elif isinstance(obj, dict):
            return {k: self._make_json_serializable(v) for k, v in obj.items()}

        return obj

    def _normalize_schema_names(self, schema):
        if isinstance(schema, dict):
            return {
                self._normalize_schema_names(k): self._normalize_schema_names(v)
                for k, v in schema.items()
            }
        elif isinstance(schema, list):
            return [self._normalize_schema_names(item) for item in schema]
        elif isinstance(schema, str):
            parts = schema.split('_')

            if parts[-1].isdigit():
                return '_'.join(parts[:-1])
            return schema
        else:
            return schema


class RequestReplay:
    def __init__(self, cache_dir: str = None):
        self.cache = RequestCache(cache_dir)
        self._replay_counters = {}  # Track replay position for each input hash

    def replay(self, inputs):
        """Replay the next response for the given inputs, cycling through stored responses."""
        input_hash = self.cache.input_hash(inputs)
        cache_data = self.cache.load(inputs)

        if cache_data is None or 'responses' not in cache_data:
            return None

        responses = cache_data['responses']
        if not responses:
            return None

        # Get current replay position for this input hash
        current_position = self._replay_counters.get(input_hash, 0)

        # Get the response at current position (cycling if we've reached the end)
        result_data = responses[current_position % len(responses)]['result']

        # Increment position for next replay
        self._replay_counters[input_hash] = current_position + 1

        return create_schema_instance_mock(result_data)

    def reset(self):
        """Reset all replay counters to start over from the beginning."""
        self._replay_counters.clear()

    def store(self, inputs, result):
        """Store a response for the given inputs, appending to existing responses."""
        cache_data = self.cache.load(inputs) or {'responses': []}

        # Simplified storage - just store the JSON result
        response_entry = {
            'schema_class': f'{result.__class__.__module__}.{result.__class__.__name__}',
            'schema': result.__class__.model_json_schema(),
            'result': result.model_dump(),
        }

        cache_data['responses'].append(response_entry)
        self.cache.save(inputs, cache_data)
