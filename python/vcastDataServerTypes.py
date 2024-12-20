from collections import OrderedDict
from enum import Enum


HOST = "localhost"
# The port will be automatically chosen by the server on
# startup and stored here, as well as echo'd to stdout
# The test client will set this via the --port arg
PORT = 0


class errorCodes(str, Enum):
    fatalError = 255
    internalServerError = 254
    testInterfaceError = 253
    couldNotStartClicastInstance = 252
    codedTestCompileError = 251


# NOTE: This class must stay in sync with typescript file vcastServer.ts: vcastCommandType
# If we find that we are changing this type frequently we might want to auto-generate
# this type from a common configuration file.


class commandType(str, Enum):
    ping = "ping"
    shutdown = "shutdown"
    closeConnection = "closeConnection"
    runClicastCommand = "runClicastCommand"
    getEnviroData = "getEnviroData"
    rebuild = "rebuild"
    executeTest = "executeTest"
    report = "report"
    parseCBT = "parseCBT"
    choiceListTst = "choiceList-tst"
    choiceListCT = "choiceList-ct"
    mcdcReport = "mcdcReport"
    mcdcLines = "mcdcLines"


class clientRequest:
    def __init__(
        self,
        command,
        clicast="",
        path="",
        test="",
        options="",
        unit="",
    ):
        self.command = command
        self.clicast = clicast
        self.path = path
        self.test = test
        self.options = options
        self.unit = unit

    def toDict(self):
        data = {}
        data["command"] = self.command
        data["clicast"] = self.clicast
        data["path"] = self.path
        data["test"] = self.test
        data["options"] = self.options
        data["unit"] = self.unit
        return data

    @classmethod
    def fromDict(cls, data):
        # these fields are mandatory
        command = data["command"]
        path = data["path"]
        # the reset are optional
        clicast = ""
        if "clicast" in data:
            clicast = data["clicast"]
        test = ""
        if "test" in data:
            test = data["test"]
        options = ""
        if "options" in data:
            options = data["options"]
        unit = ""
        if "unit" in data:
            unit = data["unit"]
        return cls(command, clicast, path, test, options, unit)


class mcdcClientRequest:
    def __init__(self, command, path="", unitName="", lineNumber=0):
        self.command = command
        self.path = path
        self.unitName = unitName
        self.lineNumber = lineNumber

    def toDict(self):
        data = {}
        data["command"] = self.command
        data["path"] = self.path
        data["unitName"] = self.unitName
        data["lineNumber"] = self.lineNumber
        return data

    @classmethod
    def fromDict(cls, data):
        # these fields are mandatory
        command = data["command"]
        path = data["path"]
        unitName = data.get("unitName", "")
        lineNumber = data.get("lineNumber", "")
        return cls(command, path, unitName, lineNumber)


class environmentData:
    def __init__(self):
        self.name = ""
        self.whitebox = False

    def toDict(self):
        data = {}
        data["name"] = self.name
        data["whitebox"] = self.whitebox
        return data


class testData:
    def __init__(self):
        self.name = ""

    def toDict(self):
        data = OrderedDict()
        data["name"] = self.name
        return data


def processPortArg(args):
    """
    This is used by the server and the client to process the --port argument
    """

    global PORT

    if args.port:
        providedPORT = args.port
        if providedPORT.isdigit():
            PORT = int(providedPORT)
        else:
            print(f"Provided --port value: '{providedPORT}' is not a number")
