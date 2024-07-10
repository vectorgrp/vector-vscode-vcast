"""
This file contains all the special stuff we need to do to compute the LSE stuff for Coded Mocks,
along with all of the work arounds for existing bugs or missing features
"""


def getParameterList(functionObject):
    # "orig_declaration" contains both the type and the
    # parameter name as originally defined.

    # PCT-FIX-NEEDED - issue #1 - duplicate parameter names
    # A special case is unnamed parameters, where "vcast_param"
    # is used, so in this case replace with vcast_param1,2,3

    paramIndex = 0
    parameterString = ""
    for parameterObject in functionObject.parameters:
        if parameterObject.name != "return":
            paramIndex += 1
            declarationToUse = parameterObject.orig_declaration
            if "vcast_param" in declarationToUse:
                uniqueParameterName = f"vcast_param{paramIndex}"
                declarationToUse = declarationToUse.replace(
                    "vcast_param", uniqueParameterName
                )
            parameterString += f" {declarationToUse},"

    if len(parameterString) == 0:
        return ""
    else:
        return f",{parameterString[:-1]}"


# function to not be shown in the functions list
tagForInit = "<<INIT>>"
functionsToIgnore = ["coded_tests_driver", tagForInit]


def isConstFunction(functionObject):
    """
    # PCT-FIX-NEEDED - issue #2 - is_const not dependable
    """

    parameterization = functionObject.parameterization
    returnValue = False
    if parameterization.endswith(" const") or parameterization.endswith(">const"):
        returnValue = True

    return returnValue


def getReturnType(functionObject):
    """
    # PCT-FIX-NEEDED - issue #5 - return type has trailing space
    """
    return functionObject.original_return_type.rstrip()


def functionCanBeVMocked(functionObject):
    """
    # PCT-FIX-NEEDED - issue #7 - is_mockable not dependable
    # Should be replaced by a single check of is_mockable

    # PCT-FIX-NEEDED - issue #8 - constructors listed as <<init>> function
    # these <<INIT>> functions should not be in the list
    # Waiting for PCT fix of FB: 101353.
    """
    if functionObject.vcast_name in functionsToIgnore:
        return False
    # Constructors are not supported by vmock
    elif functionObject.is_constructor:
        return False
    # Destructors are not supported by vmock
    elif "~" in functionObject.vcast_name:
        return False
    elif hasattr(functionObject, "is_mockable"):
        # FIXME: this is a hack to avoid generating applys that don't have lookups
        # Andrew: Which example that causes this issue?
        if not functionObject.mock_lookup_type:
            return False
        else:
            return functionObject.is_mockable
    else:
        return True


def getInstantiatingClass(api, functionObject):
    instantiatingClass = ""
    if "::" in functionObject.name:
        instantiatingClass = functionObject.name.rsplit("::", 1)[0]

        # Operators can take a type, and that type can have `::` in it, so we
        # need to break before the `::operator`
        operatorFollowedBySpace = "::operator "
        if operatorFollowedBySpace in instantiatingClass:
            idxOfOperatorFollowedBySpace = instantiatingClass.find("::operator ")
            instantiatingClass = instantiatingClass[:idxOfOperatorFollowedBySpace]
        elif "<" in instantiatingClass:
            # FIXME: we don't store the correct string for `get_by_typemark`.
            #
            # However, having `<` in the name, is likely enough to know we are
            # a class and not a namespace!
            #
            # See: checkTemplateClassExists for a more detailed (but probably
            # pointless!) way to do this.

            pass

        elif api.Type.get_by_typemark(instantiatingClass) is None:
            # We need to check if we get a class name after splitting; we only use
            # if it is a class.
            instantiatingClass = ""

        # FIXME: Hack to check if we're a static method or not
        if "::*" not in functionObject.mock_lookup_type:
            instantiatingClass = ""

    return instantiatingClass
