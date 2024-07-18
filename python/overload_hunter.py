import sys

from dataAPIutilities import functionCanBeMocked, getFunctionNameForAddress

from vector.apps.DataAPI.unit_test_api import UnitTestApi


def main():
    api = UnitTestApi(sys.argv[1])

    count = 0
    with open("tests.cpp", "w") as fd:
        fd.write('#include "unit.cpp"\n')
        fd.write("void blahblahblahblah(void) {\n")
        for unit in api.Unit.all():
            for function in unit.functions:
                if not functionCanBeMocked(function):
                    continue
                if function.is_overloaded:
                    continue
                count += 1
                fd.write(
                    f"auto fn{count} = &{getFunctionNameForAddress(api, function)};\n"
                )
        fd.write("}\n")


if __name__ == "__main__":
    main()

# EOF
