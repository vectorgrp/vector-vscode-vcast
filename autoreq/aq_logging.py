import os
import json
import logging
from logging import StreamHandler
from logging.handlers import RotatingFileHandler
from datetime import datetime, timezone
from pathlib import Path


def _get_extra(extra_dict: dict):
    ret = {}

    skip = {
        "name",
        "msg",
        "args",
        "levelname",
        "levelno",
        "pathname",
        "filename",
        "module",
        "exc_info",
        "exc_text",
        "stack_info",
        "lineno",
        "funcName",
        "created",
        "msecs",
        "relativeCreated",
        "thread",
        "threadName",
        "processName",
        "process",
    }
    for key, val in extra_dict.items():
        if key not in skip:
            ret[key] = val

    return ret


class JsonFormatter(logging.Formatter):
    def format(self, record):
        aware_ts = datetime.fromtimestamp(record.created, tz=timezone.utc)
        naive_ts = aware_ts.replace(tzinfo=None)
        payload = {
            "level": record.levelname,
            "message": record.getMessage(),
            "timestamp": naive_ts.isoformat(),
        }

        extra = _get_extra(record.__dict__)
        payload.update(extra)
        return json.dumps(payload)


class ConsoleFormatter(logging.Formatter):
    def format(self, record):
        aware_ts = datetime.fromtimestamp(record.created, tz=timezone.utc)
        naive_ts = aware_ts.replace(tzinfo=None)
        extra = _get_extra(record.__dict__)

        ret = f"{naive_ts.isoformat()} [{record.levelname}]: {record.getMessage()}"
        if extra:
            ret += "\n"
            for k, v in extra.items():
                if isinstance(v, dict) or isinstance(v, list):
                    js = json.dumps(v, indent=2, ensure_ascii=False).replace(
                        "\n", "\n\t"
                    )
                    ret += f"\t{k}:\n\t{js}\n"
                else:
                    ret += f"\t{k}: {v}\n"

        return ret.strip()


def configure_logging(
    prefix: str,
    *,
    file_env_var: str = "REQ2TESTS_LOG_TO_FILE",
    log_level_env_var: str = "REQ2TESTS_LOG_LEVEL",
):
    log_dir = Path(
        os.getenv("REQ2TESTS_LOG_DIR", Path.home() / ".req2tests-data" / "logs")
    )

    lvl_name = os.environ.get(log_level_env_var, "WARNING").upper()
    console_level = getattr(logging, lvl_name, logging.INFO)
    root = logging.getLogger()
    root.setLevel(console_level)
    for h in list(root.handlers):
        root.removeHandler(h)

    ch = StreamHandler()
    ch.setLevel(console_level)
    ch.setFormatter(ConsoleFormatter())
    root.addHandler(ch)

    if os.getenv(file_env_var, "").lower() in ("1", "true"):
        log_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_path = log_dir / f"{prefix}_{timestamp}.log"

        fh = RotatingFileHandler(log_path, maxBytes=10 * 1024 * 1024, backupCount=5)
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(JsonFormatter())
        root.addHandler(fh)

    # Set OpenAI logger level higher to prevent logging raw API requests that contain the full prompt
    oa = logging.getLogger("openai._base_client")
    oa.setLevel(max(console_level, logging.INFO))
