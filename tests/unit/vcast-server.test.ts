import * as nodeFetch from "node-fetch";
import { Response } from "node-fetch";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  closeConnection,
  serverIsAlive,
  setServerState,
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
  it("closeConnection handles successful response", async () => {
    const fetchReturn = {
      exitCode: 0,
      data: {},
    };

    mockFetch(fetchReturn);

    const result = await closeConnection("test/path");
    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:60461/vcastserver?request={"command":"closeConnection","path":"test/path"}'
    );
  });

  it("closeConnection handles internal server error", async () => {
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
      'http://localhost:60461/vcastserver?request={"command":"closeConnection","path":"test/path"}'
    );
  });

  // Testing serverIsAlive()
  it("serverIsAlive handles successful response", async () => {
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

  it("serverIsAlive handles Python interface error", async () => {
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

  it("serverIsAlive handles clicast instance start failure", async () => {
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

  // Testing transmitCommand()
  it("transmitCommand handles fetch errors with empty reason correctly", async () => {
    const errorMessage = "Network error reason: ";
    fetch.mockImplementationOnce(() => Promise.reject(new Error(errorMessage)));

    const requestObject = {
      command: vcastCommandType.ping,
      path: "",
    };

    const response = await transmitCommand(requestObject);

    expect(response.success).toBe(false);
    expect(response.statusText).toBe(
      `Enviro server error: Server is not running, disabling server mode for this session`
    );
    expect(fetch).toHaveBeenCalledWith(
      `http://localhost:60461/vcastserver?request=${JSON.stringify(requestObject)}`
    );
  });
});
