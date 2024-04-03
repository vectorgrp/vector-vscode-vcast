// This module contains all interactions with a VectorCAST environment via clicast or vpython
// The functions are organized alpabetically by the command

import { deleteEnvironmentCallback } from "./helper";

import { getEnviroNameFromID, getTestNode, testNodeType } from "./testData";
import { commandStatusType, executeCommandSync } from "./utilities";

import {
  clicastCommandToUse,
  executeWithRealTimeEcho,
  getClicastArgsFromTestNode,
} from "./vcastUtilities";

const path = require("path");

// Delete Environment
export function deleteEnvironment(enviroPath: string, enviroNodeID: string) {
  const enclosingDirectory = path.dirname(enviroPath);

  // this returns the environment directory name without any nesting
  let vcastArgs: string[] = ["-e" + getEnviroNameFromID(enviroNodeID)];
  vcastArgs.push("enviro");
  vcastArgs.push("delete");
  executeWithRealTimeEcho(
    clicastCommandToUse,
    vcastArgs,
    enclosingDirectory,
    deleteEnvironmentCallback,
    enviroNodeID
  );
}

// Delete Test Case
export function deleteSingleTest(testNodeID: string): commandStatusType {
  const testNode: testNodeType = getTestNode(testNodeID);
  const clicastArgs: string = getClicastArgsFromTestNode(testNode);
  let commandToRun = `${clicastCommandToUse} ${clicastArgs} test delete`;

  // special vcast case for delete ALL tests for the environment
  // when no unit, subprogram or test is provided, you have to give YES to delete all
  if (testNode.unitName.length == 0 && testNode.functionName.length == 0) {
    commandToRun += " YES";
  }

  let commandStatus: commandStatusType = executeCommandSync(
    commandToRun,
    path.dirname(testNode.enviroPath)
  );

  return commandStatus;
}

// Refresh Coded Test List From File
export function refreshCodedTests(
  enviroPath: string,
  enviroNodeID: string
): commandStatusType {
  // refresh the coded test file for this environment
  // note: the same file should never be associated with more than one unit

  const testNode = getTestNode(enviroNodeID);
  const enclosingDirectory = path.dirname(enviroPath);

  let commandToRun: string = `${clicastCommandToUse} ${getClicastArgsFromTestNode(
    testNode
  )} test coded refresh`;
  const refreshCommandStatus = executeCommandSync(
    commandToRun,
    enclosingDirectory
  );
  return refreshCommandStatus;
}
