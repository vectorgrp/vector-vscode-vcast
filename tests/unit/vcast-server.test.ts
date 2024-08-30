import * as nodeFetch from "node-fetch";
import { Response } from "node-fetch";
import { describe, test, expect, vi, afterEach } from "vitest";
import {
  closeConnection,
  serverIsAlive,
  serverURL,
  setLogServerCommandsCallback,
  setServerState,
  setTerminateServerCallback,
  transmitCommand,
  vcastCommandType,
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
    data: {} | { error: string[] } | { text: string[] };
  },
  status = 200,
  statusText = "OK"
) => {
  fetch.mockImplementationOnce(() =>
    Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status,
        statusText,
      })
    )
  );
};

describe("test server functions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setServerState(false);
  });

  // Testing closeConnection()
  test("closeConnection handles successful response", async () => {
    const fetchReturn = {
      exitCode: 0,
      data: {},
    };

    mockFetch(fetchReturn);

    const result = await closeConnection("test/path");
    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:60461/vassistant?request={"command":"closeConnection","path":"test/path"}'
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
      'http://localhost:60461/vassistant?request={"command":"closeConnection","path":"test/path"}'
    );
  });

  // Testing serverIsAlive()
  test("serverIsAlive handles successful response", async () => {
    const fetchReturn = {
      exitCode: 0,
      data: {},
    };

    mockFetch(fetchReturn);

    const result = await serverIsAlive();
    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:60461/ping?request={"command":"ping","path":""}'
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
      'http://localhost:60461/ping?request={"command":"ping","path":""}'
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
      'http://localhost:60461/ping?request={"command":"ping","path":""}'
    );
  });

  test("transmitCommand handles fetch errors with empty reason correctly", async () => {
    // Mock the callbacks
    const mockTerminateCallback = vi.fn();
    const mockLogServerCommandsCallback = vi.fn();

    // Set the callbacks with mock functions
    setTerminateServerCallback(mockTerminateCallback);
    setLogServerCommandsCallback(mockLogServerCommandsCallback);

    const errorMessage = "Network error reason: ";
    fetch.mockImplementationOnce(() => Promise.reject(new Error(errorMessage)));

    const requestObject = {
      command: vcastCommandType.ping,
      path: "",
    };

    const response = await transmitCommand(requestObject);

    // Check fetch call
    expect(response.success).toBe(false);
    expect(response.statusText).toBe(
      `Enviro server error: Server is not running, disabling server mode for this session`
    );
    expect(fetch).toHaveBeenCalledWith(
      `http://localhost:60461/vassistant?request=${JSON.stringify(requestObject)}`
    );

    // Check if logServerCommandsCallback was called with the correct message
    const expectedLogMessage = `Sending command: "${requestObject.command}" to server: ${serverURL()},`;
    expect(mockLogServerCommandsCallback).toHaveBeenCalledWith(
      expectedLogMessage
    );
  });
});
