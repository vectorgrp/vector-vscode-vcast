export interface testNodeType {
  enviroPath: string; // the full path including the enviro directory
  enviroName: string; // the directory name
  unitName: string;
  functionName: string;
  testName: string;
}
// this is a lookup table for the nodes in the test tree
// the key is the nodeID, the data is an testNodeDataType
var testNodeCache = new Map();

export function createTestNodeinCache(
  nodeID: string,
  enviroPath: string,
  enviroName: string,
  unitName: string = "",
  functionName: string = "",
  testName: string = ""
) {
  let testNode: testNodeType = {
    enviroPath: enviroPath,
    enviroName: enviroName,
    unitName: unitName,
    functionName: functionName,
    testName: testName,
  };
  // set will over-write if nodeID exists
  testNodeCache.set(nodeID, testNode);
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

export function clearTestNodeCache() {
  testNodeCache.clear;
}

export function getTestNode(nodeID: string): testNodeType {
  return testNodeCache.get(nodeID);
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
  return testNodeCache.get(nodeID).testName;
}
