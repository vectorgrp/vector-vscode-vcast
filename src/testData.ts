import { quote } from "./utilities";

export const compoundOnlyString = " [compound only]";

export type testNodeType = {
  enviroNodeID: string;
  enviroPath: string; // The full path including the enviro directory
  enviroName: string; // The directory name
  unitName: string;
  functionName: string;
  testName: string;
  // Initially will be used for coded-tests
  testFile: string;
  testStartLine: number;
};
// This is a lookup table for the nodes in the test tree
// the key is the nodeID, the data is an testNodeType
const testNodeCache = new Map();

export function createTestNodeinCache(
  enviroNodeID: string,
  enviroPath: string,
  enviroName: string,
  unitName = "",
  functionName = "",
  testName = "",
  testFile = "",
  testStartLine = 1
) {
  const testNode: testNodeType = {
    enviroNodeID,
    enviroPath,
    enviroName,
    unitName,
    functionName,
    testName,
    testFile,
    testStartLine,
  };
  // Set will over-write if nodeID exists
  testNodeCache.set(enviroNodeID, testNode);
}

export function addTestNodeToCache(nodeID: string, testNode: testNodeType) {
  // Set will over-write if nodeID exists
  testNodeCache.set(nodeID, testNode);
}

export function duplicateTestNode(nodeID: string) {
  // This will create a copy of an existing test node
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

export function getClicastArgsFromTestNodeAsList(
  testNode: testNodeType
): string[] {
  // This function will create the enviro, unit, subprogram, and test
  // arguments as a list, since spawn for example requires an arg list.

  const returnList = [];
  returnList.push(`-e${testNode.enviroName}`);
  if (testNode.unitName.length > 0 && testNode.unitName != "not-used")
    returnList.push(`-u${testNode.unitName}`);

  // We need the quotes on the names to handle <<COMPOUND>>/<<INIT>>/parenthesis
  if (testNode.functionName.length > 0)
    returnList.push(`-s${quote(testNode.functionName)}`);
  if (testNode.testName.length > 0) {
    const nameToUse = testNode.testName.replace(compoundOnlyString, "");
    returnList.push(`-t${quote(nameToUse)}`);
  }

  return returnList;
}

export function getClicastArgsFromTestNode(testNode: testNodeType) {
  // This function will create the enviro, unit, subprogram,
  // and test arg string for clicast calls that need a arg string

  const argumentList = getClicastArgsFromTestNodeAsList(testNode);
  return argumentList.join(" ");
}
