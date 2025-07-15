import os
import tempfile
from pathlib import Path

from autoreq.test_generation.environment import Environment
from .utils import copy_folder


def _get_env_identifiers(env, for_function=None):
    """
    Get all identifiers from the environment's testable functions.
    """
    functions_to_consider = [for_function] if for_function else env.testable_functions

    tr = env.type_resolver
    all_identifiers = []
    for func in functions_to_consider:
        all_identifiers.extend(
            tr.resolve(func['name']).to_vectorcast_identifiers(
                top_level=True, max_pointer_index=1
            )
        )
    return all_identifiers


def test_tutorial_identifiers_match(
    envs_dir,
    generic_output_recorder,
):
    current_workdir = os.getcwd()
    with tempfile.TemporaryDirectory() as out_folder:
        os.chdir(out_folder)

        copy_folder(envs_dir / 'TUTORIAL_C', Path(out_folder))

        env = Environment('TUTORIAL_C.env', use_sandbox=False)
        env.build()

        identifier_lists_to_compare = [None] + env.testable_functions

        for function in identifier_lists_to_compare:
            function_name = function['name'] if function else 'all_functions'
            file_name = f'allowed_identifiers_{function_name}.txt'

            all_identifiers = _get_env_identifiers(env, for_function=function)
            with open(file_name, 'w') as f:
                for ident in all_identifiers:
                    f.write(f'{ident}\n')

            generic_output_recorder.record_or_compare(file_name, file_name)

    os.chdir(current_workdir)


def test_compare_against_test_script_template(envs_dir):
    current_workdir = os.getcwd()
    with tempfile.TemporaryDirectory() as out_folder:
        os.chdir(out_folder)

        copy_folder(envs_dir / 'TUTORIAL_C', Path(out_folder))

        env = Environment('TUTORIAL_C.env', use_sandbox=False)
        env.build()

        test_script_template_identifiers = set(
            x for x in env._generic_allowed_identifiers_backup if 'VECTORCAST' not in x
        )
        all_identifiers = set(_get_env_identifiers(env))

        assert test_script_template_identifiers == all_identifiers

    os.chdir(current_workdir)
