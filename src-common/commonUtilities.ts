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
// VECTORCAST_DIR does not match the executable beingg run.
// Since this happens before our script even starts so we cannot suppress it.
// We could send the output to a temp file, but the create/open file operations
// have overhead.  So we just filter it out here.

// For vpython executables, we control the contents of the py script
// so we print ACTUAL-DATA at the start of the script and split on this

const vpythonSplitString = "ACTUAL-DATA";
export function cleanVPythonOutput(outputString: string): string {
  if (outputString.includes(vpythonSplitString)) {
    const pieces = outputString.split(vpythonSplitString, 2);
    return pieces[1].trim();
  } else {
    return outputString;
  }
}

// for clicast, we have no control, so we split on the copyright notice
// and add the copyright notice back in.  I considered combining this
// with the previous function, but I think this is more clear.
const clicastSplitString = "VectorCAST Copyright";
export function cleanClicastOutput(outputString: string): string {
  if (outputString.includes(clicastSplitString)) {
    const pieces = outputString.split(clicastSplitString, 2);
    return clicastSplitString + pieces[1].trim();
  } else {
    return outputString;
  }
}
