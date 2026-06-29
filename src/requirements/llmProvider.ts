import * as vscode from "vscode";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { vcastInstallationDirectory } from "../vcastInstallation";
import { showSettings } from "../utilities";
import { extractJson } from "../../src-common/commonUtilities";
import { LLM2CHECK_EXECUTABLE_PATH } from "./requirementsExecutables";
import { logCliError, logCliOperation } from "./requirementsLog";

export interface LLMProviderSettingsResult {
  provider: string | null;
  env: Record<string, string>;
  missing: string[];
}

/**
 * Project the user's LLM provider settings from VS Code config into the env
 * variables Reqs2X tools expect. Returns a list of missing required fields
 * for the chosen provider so the caller can show a useful error.
 */
export function gatherLLMProviderSettings(): LLMProviderSettingsResult {
  const config = vscode.workspace.getConfiguration("vectorcastTestExplorer");

  const provider = config.get<string>("reqs2x.provider");
  const baseEnv: Record<string, string> = {};
  const missing: string[] = [];

  if (!provider) {
    missing.push("Provider (reqs2x.provider)");
    return { provider: null, env: baseEnv, missing };
  }

  function need(value: string | undefined, label: string, envVarName: string) {
    if (!value) {
      missing.push(label);
      return;
    }
    baseEnv[envVarName] = value;
  }

  function optional(value: string | undefined, envVarName: string) {
    if (value) {
      baseEnv[envVarName] = value;
    }
  }

  if (provider === "azure_openai") {
    need(
      config.get<string>("reqs2x.azure.baseUrl"),
      "Azure Base URL",
      "VCAST_REQS2X_AZURE_OPENAI_BASE_URL"
    );
    need(
      config.get<string>("reqs2x.azure.apiKey"),
      "Azure API Key",
      "VCAST_REQS2X_AZURE_OPENAI_API_KEY"
    );
    need(
      config.get<string>("reqs2x.azure.deployment"),
      "Azure Deployment",
      "VCAST_REQS2X_AZURE_OPENAI_DEPLOYMENT"
    );
    need(
      config.get<string>("reqs2x.azure.modelName"),
      "Azure Model Name",
      "VCAST_REQS2X_AZURE_OPENAI_MODEL_NAME"
    );
    need(
      config.get<string>("reqs2x.azure.apiVersion"),
      "Azure API Version",
      "VCAST_REQS2X_AZURE_OPENAI_API_VERSION"
    );
    optional(
      config.get<string>("reqs2x.azure.reasoningModelName"),
      "VCAST_REQS2X_REASONING_AZURE_OPENAI_MODEL_NAME"
    );
    optional(
      config.get<string>("reqs2x.azure.reasoningDeployment"),
      "VCAST_REQS2X_REASONING_AZURE_OPENAI_DEPLOYMENT"
    );
  } else if (provider === "openai") {
    optional(
      config.get<string>("reqs2x.openai.baseUrl"),
      "VCAST_REQS2X_OPENAI_BASE_URL"
    );
    need(
      config.get<string>("reqs2x.openai.apiKey"),
      "OpenAI API Key",
      "VCAST_REQS2X_OPENAI_API_KEY"
    );
    need(
      config.get<string>("reqs2x.openai.modelName"),
      "OpenAI Model Name",
      "VCAST_REQS2X_OPENAI_MODEL_NAME"
    );
    optional(
      config.get<string>("reqs2x.openai.reasoningModelName"),
      "VCAST_REQS2X_REASONING_OPENAI_MODEL_NAME"
    );
  } else if (provider === "anthropic") {
    need(
      config.get<string>("reqs2x.anthropic.apiKey"),
      "Anthropic API Key",
      "VCAST_REQS2X_ANTHROPIC_API_KEY"
    );
    need(
      config.get<string>("reqs2x.anthropic.modelName"),
      "Anthropic Model Name",
      "VCAST_REQS2X_ANTHROPIC_MODEL_NAME"
    );
    optional(
      config.get<string>("reqs2x.anthropic.reasoningModelName"),
      "VCAST_REQS2X_REASONING_ANTHROPIC_MODEL_NAME"
    );
  } else if (provider === "litellm") {
    need(
      config.get<string>("reqs2x.litellm.modelName"),
      "LiteLLM Model Name",
      "VCAST_REQS2X_LITELLM_MODEL_NAME"
    );
    optional(
      config.get<string>("reqs2x.litellm.reasoningModelName"),
      "VCAST_REQS2X_REASONING_LITELLM_MODEL_NAME"
    );

    const litellmProviderEnvVarsString = config.get<string>(
      "reqs2x.litellm.providerEnvVars",
      ""
    );
    const entries = litellmProviderEnvVarsString
      .split(",")
      .map((pair) => pair.split("="))
      .filter((kv) => kv[0].trim().length);

    if (entries.some((entryValues) => entryValues.length !== 2)) {
      missing.push(
        "LiteLLM Provider Environment Variables must be KEY=VALUE pairs"
      );
    } else {
      for (const [key, value] of entries) {
        baseEnv[key.trim()] = value.trim();
      }
    }
  } else if (provider === "azure_apim") {
    need(
      config.get<string>("reqs2x.azureApim.subscriptionKey"),
      "APIM Subscription Key",
      "VCAST_REQS2X_AZURE_APIM_SUBSCRIPTION_KEY"
    );
    need(
      config.get<string>("reqs2x.azureApim.baseUrl"),
      "APIM Base URL",
      "VCAST_REQS2X_AZURE_APIM_BASE_URL"
    );
    need(
      config.get<string>("reqs2x.azureApim.modelName"),
      "APIM Model Name",
      "VCAST_REQS2X_AZURE_APIM_MODEL_NAME"
    );
    optional(
      config.get<string>("reqs2x.azureApim.apiKey"),
      "VCAST_REQS2X_AZURE_APIM_API_KEY"
    );
    optional(
      config.get<string>("reqs2x.azureApim.reasoningModelName"),
      "VCAST_REQS2X_REASONING_AZURE_APIM_MODEL_NAME"
    );
  } else if (provider === "openai_at") {
    need(
      config.get<string>("reqs2x.openaiAt.modelName"),
      "OpenAI AT Model Name",
      "VCAST_REQS2X_OPENAI_AT_MODEL_NAME"
    );
    need(
      config.get<string>("reqs2x.openaiAt.modelUrl"),
      "OpenAI AT Model URL",
      "VCAST_REQS2X_OPENAI_AT_MODEL_URL"
    );
    need(
      config.get<string>("reqs2x.openaiAt.authUrl"),
      "OpenAI AT Auth URL",
      "VCAST_REQS2X_OPENAI_AT_AUTH_URL"
    );
    need(
      config.get<string>("reqs2x.openaiAt.appKey"),
      "OpenAI AT App Key",
      "VCAST_REQS2X_OPENAI_AT_APP_KEY"
    );
    need(
      config.get<string>("reqs2x.openaiAt.appSecret"),
      "OpenAI AT App Secret",
      "VCAST_REQS2X_OPENAI_AT_APP_SECRET"
    );
    optional(
      config.get<string>("reqs2x.openaiAt.reasoningModelName"),
      "VCAST_REQS2X_REASONING_OPENAI_AT_MODEL_NAME"
    );
  } else {
    missing.push("Unsupported provider value");
  }

  return { provider, env: baseEnv, missing };
}

/**
 * Run llm2check to verify the configured provider is reachable. Used by both
 * the explicit "Test LLM Configuration" command and as a precondition before
 * invoking other Reqs2X tools.
 */
export async function isLLMProviderEnvironmentUsable(): Promise<{
  usable: boolean;
  problem: string | null;
}> {
  const processEnv = await createProcessEnvironment();
  const provider = gatherLLMProviderSettings().provider;
  const debugEnabled = processEnv.VCAST_REQS2X_LOG_LEVEL === "debug";

  logCliOperation(
    `llm2check: starting LLM provider check (provider=${
      provider ?? "<none>"
    }${debugEnabled ? ", debug=on" : ""})`
  );

  const proc = spawn(LLM2CHECK_EXECUTABLE_PATH, ["--json"], {
    env: processEnv,
  });

  return new Promise((resolve) => {
    let output = "";

    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.stderr.on("data", (data) => {
      logCliError(`llm2check: ${data.toString()}`);
    });

    proc.on("error", (err) => {
      logCliError(`llm2check: failed to spawn process: ${err.message}`);
    });

    proc.on("close", (code) => {
      const result = extractJson(output);
      if (result && typeof result.usable === "boolean") {
        if (result.usable) {
          logCliOperation(
            `llm2check: LLM provider check passed (exit ${code})`
          );
        } else {
          logCliError(
            `llm2check: LLM provider check failed (exit ${code}): ${
              result.problem ?? "<no reason reported>"
            }`
          );
        }
        resolve({ usable: result.usable, problem: result.problem || null });
      } else {
        logCliError(
          `llm2check: failed to parse output (exit ${code}). Raw output: ${output}`
        );
        resolve({ usable: false, problem: "Failed to parse llm2check output" });
      }
    });
  });
}

/**
 * Wraps `isLLMProviderEnvironmentUsable` with a user-facing error toast and
 * "Open Settings" action. Returns true if the provider is usable, false
 * otherwise (toast already shown).
 */
export async function performLLMProviderUsableCheck(): Promise<boolean> {
  const { usable, problem } = await isLLMProviderEnvironmentUsable();
  const gatheredSettings = gatherLLMProviderSettings();

  if (!usable) {
    const causedByMissing = problem?.includes(
      "No provider configuration found"
    );

    const errorMessage = causedByMissing
      ? `Required information to run Reqs2X with currently selected LLM provider (${gatheredSettings.provider}) is missing: ${gatheredSettings.missing.join(", ")}`
      : `The current LLM provider settings for Reqs2X (either set in the extension or in the environment) are not usable: ${problem}`;

    vscode.window
      .showErrorMessage(errorMessage, "Open Settings")
      .then((choice) => {
        if (choice === "Open Settings") showSettings();
      });

    return false;
  }

  return true;
}

/**
 * Build the env block Reqs2X tools expect: provider creds + extras
 * (generation language, debug logging, model-compatibility mode). Adds
 * VSCODE_VECTORCAST_DIR so the tools can find the VC installation.
 */
export async function createProcessEnvironment(): Promise<NodeJS.ProcessEnv> {
  const processEnv = { ...process.env };
  processEnv.VSCODE_VECTORCAST_DIR = vcastInstallationDirectory;

  const gatheredSettings = gatherLLMProviderSettings();
  for (const [k, v] of Object.entries(gatheredSettings.env)) {
    if (v) processEnv[k] = v;
  }

  const config = vscode.workspace.getConfiguration(
    "vectorcastTestExplorer.reqs2x"
  );
  const languageCode = config.get<string>("generationLanguage", "en");
  processEnv.VCAST_REQS2X_RESPONSE_LANGUAGE = languageCode;

  if (config.get<boolean>("outputDebugInfo", false)) {
    processEnv.VCAST_REQS2X_LOG_LEVEL = "debug";
  }

  if (config.get<boolean>("modelCompatibilityMode", false)) {
    processEnv.VCAST_REQS2X_MODEL_COMPATIBILITY_MODE = "1";
  }

  return processEnv;
}

/**
 * Spawn a Reqs2X tool with the LLM-aware env block. Performs the provider
 * check up-front; throws if the user hasn't configured a usable provider.
 */
export async function spawnWithVcastEnv(
  command: string,
  args: string[],
  options: any = {}
): Promise<ChildProcessWithoutNullStreams> {
  const checkSuccessful = await performLLMProviderUsableCheck();
  if (!checkSuccessful) {
    throw new Error("LLM provider settings are not usable");
  }

  const env = await createProcessEnvironment();
  return spawn(command, args, { ...options, env });
}
