from collections import OrderedDict
from enum import Enum


HOST = "localhost"  # The server's hostname or IP address
PORT = 60461  # The port used by the server anything > 1023 is OK


class errorCodes(str, Enum):
    internalServerError = 999
    testInterfaceError = 998
    couldNotStartClicastInstance = 997
    codedTestCompileError = 996


# NOTE: This class must stay in sync with typescript file vcastServer.ts: vcastCommandType
#
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


class clientRequest:
    def __init__(self, command, clicast="", path="", test="", options=""):
        self.command = command
        self.clicast = clicast
        self.path = path
        self.test = test
        self.options = options

    def toDict(self):
        data = {}
        data["command"] = self.command
        data["clicast"] = self.clicast
        data["path"] = self.path
        data["test"] = self.test
        data["options"] = self.options
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
        return cls(command, clicast, path, test, options)


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
            print(f"Provided --port value: '{providedPORT}' is not a number, ignoring")
