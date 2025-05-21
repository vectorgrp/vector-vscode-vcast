import axios from "axios";
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

// Mock axios
vi.mock("axios");
const mockAxiosPost = vi.mocked(axios.post);

// Generalized function to mock axios post
const mockAxios = (
  responseBody: {
    exitCode: number;
    data: Record<string, unknown> | { error: string[] } | { text: string[] };
  },
  status = 200,
  statusText = "OK"
) => {
  mockAxiosPost.mockImplementation(async () => ({
    data: responseBody,
    status,
    statusText,
  }));
};

describe("test server functions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setGLobalServerState(false);
  });

  test("closeConnection handles successful response", async () => {
    const axiosReturn = {
      exitCode: 0,
      data: {},
    };

    mockAxios(axiosReturn);

    const result = await closeConnection("test/path");
    expect(result).toBe(true);
    expect(mockAxiosPost).toHaveBeenCalledWith(
      "http://127.0.0.1:0/runcommand",
      { command: "closeConnection", path: "test/path" },
      { headers: { "Content-Type": "application/json" } }
    );
  });

  test("closeConnection handles internal server error", async () => {
    const axiosReturn = {
      exitCode: pythonErrorCodes.internalServerError,
      data: {
        error: ["Internal server error occurred"],
      },
    };

    mockAxios(axiosReturn, 500, "Internal Server Error");

    const result = await closeConnection("test/path");
    expect(result).toBe(false);
    expect(mockAxiosPost).toHaveBeenCalledWith(
      "http://127.0.0.1:0/runcommand",
      { command: "closeConnection", path: "test/path" },
      { headers: { "Content-Type": "application/json" } }
    );
  });

  test("serverIsAlive handles successful response", async () => {
    const axiosReturn = {
      exitCode: 0,
      text: "alive",
      data: {},
    };

    mockAxios(axiosReturn);

    const result = await serverIsAlive();
    expect(result).toBe(true);
    expect(mockAxiosPost).toHaveBeenCalledWith(
      "http://127.0.0.1:0/ping",
      { command: "ping", path: "" },
      { headers: { "Content-Type": "application/json" } }
    );
  });

  test("serverIsAlive handles Python interface error", async () => {
    const axiosReturn = {
      exitCode: pythonErrorCodes.testInterfaceError,
      data: {
        text: ["Python interface error"],
      },
    };

    mockAxios(axiosReturn);

    const result = await serverIsAlive();
    expect(result).toBe(false);
    expect(mockAxiosPost).toHaveBeenCalledWith(
      "http://127.0.0.1:0/ping",
      { command: "ping", path: "" },
      { headers: { "Content-Type": "application/json" } }
    );
  });

  test("serverIsAlive handles clicast instance start failure", async () => {
    const axiosReturn = {
      exitCode: pythonErrorCodes.couldNotStartClicastInstance,
      data: {},
    };

    mockAxios(axiosReturn);

    const result = await serverIsAlive();
    expect(result).toBe(false);
    expect(mockAxiosPost).toHaveBeenCalledWith(
      "http://127.0.0.1:0/ping",
      { command: "ping", path: "" },
      { headers: { "Content-Type": "application/json" } }
    );
  });

  test("transmitCommand handles exitCode 254 response correctly", async () => {
    const mockTerminateCallback = vi.fn();
    const mockLogServerCommandsCallback = vi.fn();

    setTerminateServerCallback(mockTerminateCallback);
    setLogServerCommandsCallback(mockLogServerCommandsCallback);

    const axiosReturn = {
      exitCode: pythonErrorCodes.internalServerError,
      data: {},
    };

    mockAxios(axiosReturn);

    const requestObject = {
      command: vcastCommandType.ping,
      path: "",
    };

    const response = await transmitCommand(requestObject);

    expect(response.success).toBe(false);
    expect(mockAxiosPost).toHaveBeenCalledWith(
      `http://127.0.0.1:0/runcommand`,
      requestObject,
      { headers: { "Content-Type": "application/json" } }
    );

    const expectedLogMessage = `Sending command: "${requestObject.command}" to server: ${serverURL()},`;
    expect(mockLogServerCommandsCallback).toHaveBeenCalledWith(
      expectedLogMessage
    );

    await terminateServerProcessing("Error string").catch((error) => {
      console.error("Failed to terminate server:", error);
    });

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

    const axiosReturn = {
      exitCode: pythonErrorCodes.couldNotStartClicastInstance,
      data: {},
    };
    mockAxios(axiosReturn);

    const result = await serverIsAlive();

    expect(result).toBe(false);

    expect(mockLogCallback).toHaveBeenCalledWith(
      "Server not ready, waiting 200ms ..."
    );
    expect(mockLogCallback).toHaveBeenCalledWith(
      "Server timed out on startup, did not answer ping"
    );
  });

  test("transmitCommand should handle axios error with empty reason correctly (TextLength = 0)", async () => {
    const mockTerminateCallback = vi.fn();
    const mockLogServerCommandsCallback = vi.fn();

    setTerminateServerCallback(mockTerminateCallback);
    setLogServerCommandsCallback(mockLogServerCommandsCallback);

    const errorMessage = "Network error reason: ";
    mockAxiosPost.mockImplementationOnce(async () => {
      throw new Error(errorMessage);
    });

    const requestObject = {
      command: vcastCommandType.rebuild,
      path: "",
    };

    const response = await transmitCommand(requestObject);

    expect(response.success).toBe(false);
    expect(response.statusText).toBe(
      `Enviro server error: command: rebuild, error: cannot communicate with server on port: 0`
    );
    expect(mockAxiosPost).toHaveBeenCalledWith(
      `http://127.0.0.1:0/runcommand`,
      requestObject,
      { headers: { "Content-Type": "application/json" } }
    );

    const expectedLogMessage = `Sending command: "${requestObject.command}" to server: http://127.0.0.1:0,`;
    expect(mockLogServerCommandsCallback).toHaveBeenCalledWith(
      expectedLogMessage
    );

    expect(mockTerminateCallback).toHaveBeenCalledOnce();
  });

  test("should change port number and sendShutdownToServer should send shutdown command", async () => {
    setServerPort(69);
    const newServerPort = getServerPort();

    expect(newServerPort).toBe(69);

    const axiosReturn = {
      exitCode: 0,
      data: {},
    };
    mockAxios(axiosReturn);

    await sendShutdownToServer();

    expect(mockAxiosPost).toHaveBeenCalledWith(
      "http://127.0.0.1:69/shutdown",
      { command: "shutdown", path: "" },
      { headers: { "Content-Type": "application/json" } }
    );
  });
});
