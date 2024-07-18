import sys

from dataAPIutilities import functionCanBeMocked, getFunctionNameForAddress

from vector.apps.DataAPI.unit_test_api import UnitTestApi


def main():
    api = UnitTestApi(sys.argv[1])

    count = 0
    with open(sys.argv[2], "w") as fd:
        fd.write('#include "unit.cpp"\n')
        fd.write("void blahblahblahblah(void) {\n")
        for unit in api.Unit.all():
            for function in unit.functions:
                if not functionCanBeMocked(function):
                    continue
                if function.is_overloaded:
                    continue
                name_for_addr = getFunctionNameForAddress(api, function)
                if "vcast_concrete_" in name_for_addr or name_for_addr in ["pthread_cond_clockwait", "pthread_mutex_clocklock"] or "(" in name_for_addr:
                    continue
                count += 1
                fd.write(
                    f"auto fn{count} = &{getFunctionNameForAddress(api, function)};\n"
                )
        fd.write("}\n")


if __name__ == "__main__":
    main()

# EOF
