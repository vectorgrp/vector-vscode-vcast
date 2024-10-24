import * as nodeFetch from "node-fetch";
import { Response } from "node-fetch";
import { describe, test, expect, vi, afterEach } from "vitest";
import {
  closeConnection,
  serverIsAlive,
  serverURL,
  setLogServerCommandsCallback,
  setGLobalServerState,
  setTerminateServerCallback,
  transmitCommand,
  vcastCommandType,
  terminateServerProcessing,
  sendShutdownToServer,
  globalEnviroDataServerActive,
  setServerPort,
  getGLobalServerState,
  getServerPort,
} from "../../src-common/vcastServer";
import { pythonErrorCodes } from "../../src-common/vcastServerTypes";

vi.mock("node-fetch", async () => {
  const actual = await vi.importActual<typeof nodeFetch>("node-fetch");

  return {
    ...actual,
    default: vi.fn(),
  };
});

const fetch = vi.mocked(nodeFetch.default);

// Generalized function to mock fetch
const mockFetch = (
  responseBody: {
    exitCode: number;
    data: Record<string, unknown> | { error: string[] } | { text: string[] };
  },
  status = 200,
  statusText = "OK"
) => {
  fetch.mockImplementation(
    async () =>
      new Response(JSON.stringify(responseBody), {
        status,
        statusText,
      })
  );
};

describe("test server functions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setGLobalServerState(false);
  });

  test("closeConnection handles successful response", async () => {
    const fetchReturn = {
      exitCode: 0,
      data: {},
    };

    mockFetch(fetchReturn);

    const result = await closeConnection("test/path");
    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:0/runcommand?request={"command":"closeConnection","path":"test/path"}'
    );
  });

  test("closeConnection handles internal server error", async () => {
    const fetchReturn = {
      exitCode: pythonErrorCodes.internalServerError,
      data: {
        error: ["Internal server error occurred"],
      },
    };

    mockFetch(fetchReturn, 500, "Internal Server Error");

    const result = await closeConnection("test/path");
    expect(result).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:0/runcommand?request={"command":"closeConnection","path":"test/path"}'
    );
  });

  test("serverIsAlive handles successful response", async () => {
    const fetchReturn = {
      exitCode: 0,
      text: "alive",
      data: {},
    };

    mockFetch(fetchReturn);

    const result = await serverIsAlive();
    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:0/ping?request={"command":"ping","path":""}'
    );
  });

  test("serverIsAlive handles Python interface error", async () => {
    const fetchReturn = {
      exitCode: pythonErrorCodes.testInterfaceError,
      data: {
        text: ["Python interface error"],
      },
    };

    mockFetch(fetchReturn);

    const result = await serverIsAlive();
    expect(result).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:0/ping?request={"command":"ping","path":""}'
    );
  });

  test("serverIsAlive handles clicast instance start failure", async () => {
    const fetchReturn = {
      exitCode: pythonErrorCodes.couldNotStartClicastInstance,
      data: {},
    };

    mockFetch(fetchReturn);

    const result = await serverIsAlive();
    expect(result).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:0/ping?request={"command":"ping","path":""}'
    );
  });

  test("transmitCommand handles exitCode 254 response correctly", async () => {
    // Mock the callbacks
    const mockTerminateCallback = vi.fn();
    const mockLogServerCommandsCallback = vi.fn();

    // Set the callbacks with mock functions
    setTerminateServerCallback(mockTerminateCallback);
    setLogServerCommandsCallback(mockLogServerCommandsCallback);

    // Prepare the mock response for exitCode 254
    const fetchReturn = {
      exitCode: pythonErrorCodes.internalServerError,
      data: {},
    };

    mockFetch(fetchReturn);

    const requestObject = {
      command: vcastCommandType.ping,
      path: "",
    };

    const response = await transmitCommand(requestObject);

    // Check fetch call
    expect(response.success).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:0/runcommand?request=${JSON.stringify(requestObject)}`
    );

    // Check if logServerCommandsCallback was called with the correct message
    const expectedLogMessage = `Sending command: "${requestObject.command}" to server: ${serverURL()},`;
    expect(mockLogServerCommandsCallback).toHaveBeenCalledWith(
      expectedLogMessage
    );

    // XO wants then / catch
    await terminateServerProcessing("Error string")
      .then(() => {
        // Success
      })
      .catch((error) => {
        console.error("Failed to terminate server:", error);
      });

    // Verify that the terminate callback is triggered
    expect(mockTerminateCallback).toHaveBeenCalledOnce();
    expect(mockTerminateCallback).toHaveBeenCalledWith("Error string");
  });

  test("setGLobalServerState should update globalEnviroDataServerActive", () => {
    expect(globalEnviroDataServerActive).toBe(false);
    setGLobalServerState(true);
    const newGlobalState = getGLobalServerState();
    expect(newGlobalState).toBe(true);
  });

  test("serverIsAlive should log retry messages and timeout if server isn't ready", async () => {
    const mockLogCallback = vi.fn();
    setLogServerCommandsCallback(mockLogCallback);

    // Simulate server not being ready by returning failure initially
    const fetchReturn = {
      exitCode: pythonErrorCodes.couldNotStartClicastInstance,
      data: {},
    };
    mockFetch(fetchReturn);

    const result = await serverIsAlive();

    // Expect server to have failed after retrying
    expect(result).toBe(false);

    // Ensure retry log messages were printed
    expect(mockLogCallback).toHaveBeenCalledWith(
      "Server not ready, waiting 200ms ..."
    );
    expect(mockLogCallback).toHaveBeenCalledWith(
      "Server timed out on startup, did not answer ping"
    );
  });

  test("transmitCommand should handle fetch error with empty reason correctly (TextLength = 0)", async () => {
    // Mock the callbacks
    const mockTerminateCallback = vi.fn();
    const mockLogServerCommandsCallback = vi.fn();

    // Set the callbacks with mock functions
    setTerminateServerCallback(mockTerminateCallback);
    setLogServerCommandsCallback(mockLogServerCommandsCallback);

    // Simulate empty reason
    const errorMessage = "Network error reason: ";
    fetch.mockImplementationOnce(async () => {
      throw new Error(errorMessage);
    });

    // Any command other than ping or shutdown
    const requestObject = {
      command: vcastCommandType.rebuild,
      path: "",
    };

    const response = await transmitCommand(requestObject);

    // Check fetch call
    expect(response.success).toBe(false);
    expect(response.statusText).toBe(
      `Enviro server error: command: rebuild, error: cannot communicate with server on port: 0`
    );
    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:0/runcommand?request=${JSON.stringify(requestObject)}`
    );

    // Check if logServerCommandsCallback was called with the correct message
    const expectedLogMessage = `Sending command: "${requestObject.command}" to server: http://127.0.0.1:0,`;
    expect(mockLogServerCommandsCallback).toHaveBeenCalledWith(
      expectedLogMessage
    );

    // Check if the terminate callback was called due to the error
    expect(mockTerminateCallback).toHaveBeenCalledOnce();
  });

  test("should change port number and sendShutdownToServer should send shutdown command", async () => {
    // Port number does not matter as we mock the server fetch
    // We just want to test the Port set function here
    setServerPort(69);
    const newServerPort = getServerPort();

    expect(newServerPort).toBe(69);

    const fetchReturn = {
      exitCode: 0,
      data: {},
    };
    mockFetch(fetchReturn);

    await sendShutdownToServer();

    // Important: Check with new port
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:69/shutdown?request={"command":"shutdown","path":""}'
    );
  });
});
