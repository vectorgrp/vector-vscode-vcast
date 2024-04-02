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
var testNodeCache = new Map();

export function createTestNodeinCache(
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
  testNodeCache.clear;
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
