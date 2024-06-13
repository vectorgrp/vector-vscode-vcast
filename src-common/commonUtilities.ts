// This file is for stuff to be shared between the client and the server
// It is important that this file NOT import any VS Code stuff

const fs = require("node:fs");
const path = require("node:path");

const enviroNameRegEx = /--.*Environment.*:(.*)/;
export function getEnviroNameFromScript(
  testScriptPath: string
): string | undefined {
  let enviroName: string | undefined;
  if (fs.existsSync(testScriptPath)) {
    const lineList = fs.readFileSync(testScriptPath).toString().split("\n");
    for (const line of lineList) {
      const result = line.match(enviroNameRegEx);
      if (result) {
        enviroName = result[1].trim();
        break;
      }
    }
  }

  return enviroName;
}

// Initially I thought I needed to get multiple option, so I implemented this way to make that easy
// but it turns out that I did not really need the SOURCE_EXTENSION ... but I am leaving this as an example

export type cfgOptionType = {
  C_DEBUG_CMD: string;
  SOURCE_EXTENSION: string;
};

// We keep a cache so we don't have to do the parse if
// we've seen this path before
const cfgOptionCache = new Map<string, cfgOptionType>();

export function getVcastOptionValues(enviroPath: string): cfgOptionType {
  // This will read the CCAST_.CFG file in the directoryPath and
  // return a list of values for the options in optionList

  const cfgLocation = path.dirname(enviroPath);
  const cachedObject = cfgOptionCache.get(cfgLocation);
  if (cachedObject == undefined) {
    const newObject: cfgOptionType = { C_DEBUG_CMD: "", SOURCE_EXTENSION: "" };
    const cfgPath = path.join(cfgLocation, "CCAST_.CFG");
    if (fs.existsSync(cfgPath)) {
      const lines = fs
        .readFileSync(cfgPath, "utf8")
        .replace("\r", "")
        .split("\n");
      for (const line of lines) {
        if (line.startsWith("C_DEBUG_CMD")) {
          newObject.C_DEBUG_CMD = line.split(":")[1].trim();
        } else if (line.startsWith("SOURCE_EXTENSION")) {
          newObject.SOURCE_EXTENSION = line.split(":")[1].trim();
        }
      }
    }

    // Only cache this if it had "good data"
    if (
      newObject.C_DEBUG_CMD.length > 0 &&
      newObject.SOURCE_EXTENSION.length > 0
    )
      cfgOptionCache.set(cfgLocation, newObject);
    return newObject;
  }

  return cachedObject;
}
