import argparse
import tempfile
from autoreq.requirements_manager import RequirementsManager
from autoreq.test_generation.environment import Environment
from autoreq.code2reqs import save_requirements_to_csv, execute_rgw_commands


def main(requirement_file, env_path, gateway_path):
    env = Environment(env_path)
    rm = RequirementsManager(requirement_file, discard_none_functions=False)

    with tempfile.NamedTemporaryFile(delete=False) as temp_file:
        temp_file_path = temp_file.name
        save_requirements_to_csv(rm._requirements, temp_file_path)

        execute_rgw_commands(env_path, temp_file_path, gateway_path)

    env.cleanup()


def cli():
    parser = argparse.ArgumentParser(
        description='Load a requirement file into the requirements gateway of a VectorCAST environment.'
    )
    parser.add_argument(
        'env_path', help='Path to the VectorCAST environment directory.'
    )
    parser.add_argument(
        'requirement_file', help='Path to the file containing requirements.'
    )
    parser.add_argument(
        '--gateway-path',
        help='Path to the file containing requirements.',
        default='generated_requirement_repository',
    )

    args = parser.parse_args()

    main(args.requirement_file, args.env_path, args.gateway_path)


if __name__ == '__main__':
    cli()
