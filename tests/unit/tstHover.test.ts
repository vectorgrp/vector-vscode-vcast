/* eslint-disable @typescript-eslint/no-var-requires */
import { describe, expect, test } from "vitest";
import { getHoverPositionForLine, generateHoverData } from "./utils";

const timeout = 30000; // 30 seconds

const initialTst = `
-- Environment: TEST
TEST.UNIT:unit
TEST.SUBPROGRAM:bar`;

const slotTst = `TEST.SLOT:`;

const valTst = `TEST.NEW
TEST.NAME:valueHover
TEST.VALUE:unit.bar.return:1
TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

const reqTst = `TEST.NEW
TEST.NAME:valueHover
TEST.REQUIREMENT_KEY:FR20
TEST.REQUIREMENT_KEY:FR20 | Clearing a table resets orders for all seats
TEST.VALUE:unit.bar.return:1
TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

const expTst = `TEST.NEW
TEST.NAME:valueHover
TEST.VALUE:unit.bar.return:1
TEST.EXPECTED:unit.bar.return:2
TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

const invalidEnviroTst = `-- Environment: @TEST
TEST.UNIT:unit
TEST.SUBPROGRAM:bar
TEST.NEW
TEST.NAME:valueHover
TEST.VALUE:unit.bar.return:1
TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

describe("Hover Info Validator", () => {
  test(
    "validate hover over TEST.SLOT:",
    async () => {
      const tstText = [initialTst, slotTst].join("\n");
      const expectedHoverString =
        "format: slot-number, unit-name, function-name, iteration-count, test-name";

      const hoverPosition = getHoverPositionForLine(
        "TEST.SLOT:",
        tstText,
        "TEST.SLOT"
      );
      const generatedHoverString = generateHoverData(tstText, hoverPosition);
      expect(generatedHoverString).toBe(expectedHoverString);
    },
    timeout
  );

  test(
    "validate hover over TEST.VALUE:",
    async () => {
      const tstText = [initialTst, valTst].join("\n");
      const expectedHoverString = "int";

      const hoverPosition = getHoverPositionForLine(
        "TEST.VALUE:unit.bar.return:1",
        tstText,
        "return"
      );
      const generatedHoverString = generateHoverData(tstText, hoverPosition);
      expect(generatedHoverString).toBe(expectedHoverString);
    },
    timeout
  );
  
  test(
    "validate hover over TEST.REQUIREMENT_KEY:FR20",
    async () => {
      const tstText = [initialTst, reqTst].join("\n");
      const expectedFRTitle = "Clearing a table resets orders for all seats";
      const expectedFRDesc = "Clearing a table clears the orders for all seats of the table within the table database.";
      const hoverPosition = getHoverPositionForLine(
        "TEST.REQUIREMENT_KEY:FR20",
        tstText,
        "KEY"
      );
      const generatedHoverString = generateHoverData(tstText, hoverPosition);
      expect(generatedHoverString).toContain(expectedFRTitle)
      expect(generatedHoverString).toContain(expectedFRDesc)
    },
    timeout
  );
  
  test(
    "validate hover over TEST.REQUIREMENT_KEY:FR20 | Clearing a table resets orders for all seats",
    async () => {
      const tstText = [initialTst, reqTst].join("\n");
      const expectedFRTitle = "Clearing a table resets orders for all seats";
      const expectedFRDesc = "Clearing a table clears the orders for all seats of the table within the table database.";
      const hoverPosition = getHoverPositionForLine(
        "TEST.REQUIREMENT_KEY:FR20 | Clearing a table resets orders for all seats",
        tstText,
        "FR20"
      );
      const generatedHoverString = generateHoverData(tstText, hoverPosition);
      expect(generatedHoverString).toContain(expectedFRTitle)
      expect(generatedHoverString).toContain(expectedFRDesc)
    },
    timeout
  );

  test(
    "validate hover over TEST.EXPECTED:",
    async () => {
      const tstText = [initialTst, expTst].join("\n");
      const expectedHoverString = "int";

      const hoverPosition = getHoverPositionForLine(
        "TEST.EXPECTED:unit.bar.return:2",
        tstText,
        "return"
      );
      const generatedHoverString = generateHoverData(tstText, hoverPosition);
      expect(generatedHoverString).toBe(expectedHoverString);
    },
    timeout
  );

  test(
    "validate handling of invalid environment name:",
    async () => {
      const tstText = invalidEnviroTst;
      const expectedHoverString = "";

      const hoverPosition = getHoverPositionForLine(
        "TEST.EXPECTED:unit.bar.return:2",
        tstText,
        "return"
      );
      const generatedHoverString = generateHoverData(tstText, hoverPosition);
      expect(generatedHoverString).toBe(expectedHoverString);
    },
    timeout
  );
});
