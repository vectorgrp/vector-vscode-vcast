import sys
import argparse
import json
from autoreq.util import ENV_STORE


def cli():
    parser = argparse.ArgumentParser(
        description="Manage encrypted environment variables"
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # Set command
    set_parser = subparsers.add_parser("set", help="Set an environment variable")
    set_parser.add_argument("key", help="Environment variable name")
    set_parser.add_argument("value", help="Environment variable value")

    # Get command
    get_parser = subparsers.add_parser("get", help="Get an environment variable")
    get_parser.add_argument("key", help="Environment variable name")

    # List command
    subparsers.add_parser("list", help="List all stored environment variables")

    # Clear command
    subparsers.add_parser("clear", help="Clear all stored environment variables")

    args = parser.parse_args()

    if args.command == "set":
        ENV_STORE.store(args.key, args.value)
        print(f"Stored value for {args.key}")

    elif args.command == "get":
        try:
            value = ENV_STORE.load(args.key)
            print(value)
        except KeyError:
            print(f"No value found for {args.key}")
            sys.exit(1)

    elif args.command == "list":
        try:
            print(json.dumps(ENV_STORE._cache, indent=2))
        except Exception as e:
            print(json.dumps({"error": str(e)}))
            sys.exit(1)

    elif args.command == "clear":
        ENV_STORE.clear()
        print("Cleared all stored variables")

    else:
        parser.print_help()


if __name__ == "__main__":
    cli()
