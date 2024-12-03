import { normalizePath, quote } from "./utilities";

export interface environmentNodeDataType {
  projectPath: string;
  buildDirectory: string;
  isBuilt: boolean;
  displayName: string;
  workspaceRoot: string;
}

// This is a lookup table for all environment nodes
// in the test case tree.  The key is the environmentPath
// and the data is an environmentDataType
let environmentDataCache = new Map();

export function saveEnviroNodeData(
  enviroPath: string,
  data: environmentNodeDataType
) {
  // normalize the path since we use it as a key
  environmentDataCache.set(normalizePath(enviroPath), data);
}

export function getEnviroNodeData(enviroPath: string): environmentNodeDataType {
  // normalize the path since we use it as a key
  return environmentDataCache.get(normalizePath(enviroPath));
}

export function clearEnviroDataCache() {
  environmentDataCache.clear();
}

export const compoundOnlyString = " [compound only]";

export interface testNodeType {
  enviroNodeID: string;
  enviroPath: string; // the full path including the enviro directory
  enviroName: string; // the directory name
  unitName: string;
  functionName: string;
  testName: string;
  // initially will be used for coded-tests
  testFile: string;
  testStartLine: number;
}
// this is a lookup table for the nodes in the test tree
// the key is the nodeID, the data is an testNodeType
let testNodeCache = new Map();

// This function is used to create the top-level environment
// node in the cache, all the other nodes will inherit from
// this one and add their own data
export function createTestNodeInCache(
  enviroNodeID: string,
  enviroPath: string,
  enviroName: string,
  unitName: string = "",
  functionName: string = "",
  testName: string = "",
  testFile: string = "",
  testStartLine: number = 1
) {
  let testNode: testNodeType = {
    enviroNodeID: enviroNodeID,
    enviroPath: enviroPath,
    enviroName: enviroName,
    unitName: unitName,
    functionName: functionName,
    testName: testName,
    testFile: testFile,
    testStartLine: testStartLine,
  };
  // set will over-write if nodeID exists
  testNodeCache.set(enviroNodeID, testNode);
}

export function addTestNodeToCache(nodeID: string, testNode: testNodeType) {
  // set will over-write if nodeID exists
  testNodeCache.set(nodeID, testNode);
}

export function duplicateTestNode(nodeID: string) {
  // this will create a copy of an existing test node
  // this is ued for child nodes where we want the same enviro,
  // unit etc for the lower levels
  const existingNode = testNodeCache.get(nodeID);
  return JSON.parse(JSON.stringify(existingNode));
}

export function removeNodeFromCache(nodeID: string) {
  testNodeCache.delete(nodeID);
}

export function nodeIsInCache(nodeID: string) {
  return testNodeCache.has(nodeID);
}

export function clearTestNodeCache() {
  testNodeCache.clear();
}

export function getTestNode(nodeID: string): testNodeType {
  return testNodeCache.get(nodeID);
}

export function getEnviroNodeIDFromID(nodeID: string): string {
  return testNodeCache.get(nodeID).enviroNodeID;
}

export function getEnviroPathFromID(nodeID: string): string {
  return testNodeCache.get(nodeID).enviroPath;
}

export function getEnviroNameFromID(nodeID: string): string {
  return testNodeCache.get(nodeID).enviroName;
}

export function getUnitNameFromID(nodeID: string): string {
  return testNodeCache.get(nodeID).unitName;
}

export function getFunctionNameFromID(nodeID: string): string {
  return testNodeCache.get(nodeID).functionName;
}

export function getTestNameFromID(nodeID: string): string {
  const testName = testNodeCache.get(nodeID).testName;
  return testName.replace(compoundOnlyString, "");
}

function getArgumentString(argString: string, usingServer: boolean) {
  // This function will either quote or not quote the argument string
  // based on whether the command is being run using the vcast data server
  // For normal calls to clicast, we need to quote the subprogram and test strings, to
  // "protect" special characters [ e.g. <,>,(,) ] from the shell.
  // However, when the server is running we cannot do this as the server
  // will interpret the quotes as part of the string.
  //
  // It is up to the caller to set the "usingServer" flag correctly, because
  // even when the server is running, we sometimes call clicast directly
  // for things like generate basis path etc.

  if (usingServer) {
    return argString;
  } else {
    return quote(argString);
  }
}

export function getClicastArgsFromTestNodeAsList(
  testNode: testNodeType,
  usingServer: boolean = false
): string[] {
  // this function will create the enviro, unit, subprogram, and test
  // arguments as a list, since spawn for example requires an arg list.

  let returnList = [];
  returnList.push(`-e${testNode.enviroName}`);
  if (testNode.unitName.length > 0 && testNode.unitName != "not-used")
    returnList.push(`-u${testNode.unitName}`);

  // we need the quotes on the names to handle <<COMPOUND>>/<<INIT>>/parenthesis
  if (testNode.functionName.length > 0)
    returnList.push(
      `-s${getArgumentString(testNode.functionName, usingServer)}`
    );
  if (testNode.testName.length > 0) {
    const nameToUse = testNode.testName.replace(compoundOnlyString, "");
    returnList.push(`-t${getArgumentString(nameToUse, usingServer)}`);
  }

  return returnList;
}

export function getClicastArgsFromTestNode(
  testNode: testNodeType,
  usingServer: boolean = false
): string {
  // this function will create the enviro, unit, subprogram,
  // and test arg string for clicast calls that need a arg string

  const argList = getClicastArgsFromTestNodeAsList(testNode, usingServer);
  return argList.join(" ");
}
