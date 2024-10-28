// This file is for stuff to be shared between the client and the server
// It is important that this file NOT import any VS Code stuff

const fs = require("fs");
const path = require("path");

export interface enviroDataType {
  enviroPath: string;
  hasMockSupport: boolean;
}

const enviroNameRegEx = /--.*Environment.*:(.*)/;
export function getEnviroNameFromScript(
  testScriptPath: string
): string | undefined {
  let enviroName: string | undefined = undefined;
  if (fs.existsSync(testScriptPath)) {
    const lineList = fs.readFileSync(testScriptPath).toString().split("\n");
    for (let line of lineList) {
      let result = line.match(enviroNameRegEx);
      if (result) {
        enviroName = result[1].trim();
        break;
      }
    }
  }
  return enviroName;
}

// Initially I thought I needed to get multiple options, so I implemented it this way to make that easy
// but it turns out that I did not really need the SOURCE_EXTENSION ... but I am leaving this as an example

export interface cfgOptionType {
  C_DEBUG_CMD: string;
  SOURCE_EXTENSION: string;
}

// we keep a cache so we don't have to do the parse if
// we've seen this path before
var cfgOptionCache: Map<string, cfgOptionType> = new Map();

export function getVcastOptionValues(enviroPath: string): cfgOptionType {
  // this will read the CCAST_.CFG file in the directoryPath and
  // return a list of values for the options in optionList

  const cfgLocation = path.dirname(enviroPath);
  const cachedObject = cfgOptionCache.get(cfgLocation);
  if (cachedObject == undefined) {
    let newObject: cfgOptionType = { C_DEBUG_CMD: "", SOURCE_EXTENSION: "" };
    const cfgPath = path.join(cfgLocation, "CCAST_.CFG");
    if (fs.existsSync(cfgPath)) {
      const lines = fs
        .readFileSync(cfgPath, "utf-8")
        .replace("\r", "")
        .split("\n");
      for (let line of lines) {
        if (line.startsWith("C_DEBUG_CMD")) {
          newObject.C_DEBUG_CMD = line.split(":")[1].trim();
        } else if (line.startsWith("SOURCE_EXTENSION")) {
          newObject.SOURCE_EXTENSION = line.split(":")[1].trim();
        }
      }
    }
    // only cache this if it had "good data"
    if (
      newObject.C_DEBUG_CMD.length > 0 &&
      newObject.SOURCE_EXTENSION.length > 0
    )
      cfgOptionCache.set(cfgLocation, newObject);
    return newObject;
  } else {
    return cachedObject;
  }
}

// The VectorCAST executables print an annoying message to stdout when
// VECTORCAST_DIR does not match the executable being run.
// Since this happens before our script even starts so we cannot suppress it.

// For out own vpython executables, we control the contents of the py script
// so we print ACTUAL-DATA at the start of the script and split on this
// Improvement needed: we could remove this ACTUAL-DATA stuff now that we
// created this common way to clean the output

// For clicast and ATG, we have no control, so we split on the
// "If you want to use VECTORCAST_DIR, use this syntax" message

// We export these just so that the tests can use these without duplication
export const vpythonSplitString = "ACTUAL-DATA";
export const atgAndClicastSplitString =
  "If you want to use VECTORCAST_DIR, use this syntax:";
export function cleanVectorcastOutput(outputString: string): string {
  if (outputString.includes(vpythonSplitString)) {
    const pieces = outputString.split(vpythonSplitString, 2);
    return pieces[1].trim();
  } else if (outputString.includes(atgAndClicastSplitString)) {
    // there are two lines that we want to remove beyond the split string
    const pieces = outputString.split(atgAndClicastSplitString, 2);
    const restOfText = pieces[1].trim();
    const lines = restOfText.split("\n");
    return lines.slice(2).join("\n");
  } else {
    return outputString;
  }
}
