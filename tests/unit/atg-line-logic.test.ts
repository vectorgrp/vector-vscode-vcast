import { describe, expect, test } from "vitest";
import {
  type VariableInfo,
  buildLookupFromNodes,
  buildVariableValues,
  choosePreviewWindow,
  computeClickableTokens,
  decisionExtent,
  findFunctionBounds,
  flattenLookup,
  getDefaultIndexFromLineText,
  isDecisionLineText,
  lookupPath,
  resolvePathFromLine,
} from "../../src/atgLineLogic";

/** Lookup shaped like the DEMO tutorial's Manager::AddIncludedDessert. */
function demoLookup(): Map<string, VariableInfo> {
  const lookup = new Map<string, VariableInfo>();
  buildLookupFromNodes(
    [
      {
        name: "Order",
        displayType: "OrderType *",
        kind: "array",
        children: [
          {
            name: "Entree",
            displayType: "enum Entrees",
            kind: "enum",
            enumValues: ["Steak", "Chicken"],
          },
          { name: "Dessert", displayType: "enum Desserts", kind: "enum" },
        ],
      },
    ],
    lookup,
    "parameter"
  );
  buildLookupFromNodes(
    [
      {
        name: "TableData",
        displayType: "struct TableDataType",
        kind: "struct",
        children: [{ name: "IsOccupied", displayType: "bool", kind: "bool" }],
      },
      { name: "WaitingListSize", displayType: "unsigned", kind: "int" },
    ],
    lookup,
    "global"
  );
  return lookup;
}

describe("resolvePathFromLine", () => {
  test("walks back over -> and . member accesses", () => {
    const line = "x = s->f.g;";
    expect(resolvePathFromLine(line, line.indexOf("g"), "g")).toBe("s.f.g");
  });

  test("tolerates whitespace around accessors", () => {
    const line = "  a . b -> c = 1;";
    expect(resolvePathFromLine(line, line.indexOf("c"), "c")).toBe("a.b.c");
  });

  test("returns the bare name when there is no accessor", () => {
    expect(resolvePathFromLine("foo(bar);", 4, "bar")).toBe("bar");
  });

  test("stops when an accessor has no parent identifier", () => {
    expect(resolvePathFromLine("->g", 2, "g")).toBe("g");
    expect(resolvePathFromLine(".g", 1, "g")).toBe("g");
  });
});

describe("isDecisionLineText", () => {
  test.each([
    ["if (x) {", true],
    ["  } else if (y)", true],
    ["while(cond)", true],
    ["for (int i = 0; i < n; i++) {", true],
    ["switch (Order.Entree) {", true],
    ["} while (Name && *Name);", true],
    ["x = a ? b : c;", true],
    ["x = 1;", false],
    ["iffy(3);", false],
    ["  return;", false],
  ])("%s -> %s", (text, expected) => {
    expect(isDecisionLineText(text)).toBe(expected);
  });
});

describe("decisionExtent", () => {
  const lines = [
    "void f() {",
    "  if(Order->Entree == Steak &&",
    "     Order->Salad == Caesar &&",
    "     Order->Beverage == MixedDrink) {",
    "    Order->Dessert = Pies;",
    "  }",
    "  while (x) y();",
    "}",
  ];

  test("spans a multi-line condition until the parentheses balance", () => {
    expect(decisionExtent(lines, 2)).toEqual({ start: 2, end: 4 });
  });

  test("keeps single-line decisions and statements to one line", () => {
    expect(decisionExtent(lines, 7)).toEqual({ start: 7, end: 7 });
    expect(decisionExtent(lines, 5)).toEqual({ start: 5, end: 5 });
  });

  test("never runs past the cap or the file", () => {
    const open = ["if (a &&", "b &&", "c &&", "d &&", "e"];
    expect(decisionExtent(open, 1, 3)).toEqual({ start: 1, end: 3 });
    expect(decisionExtent(open, 1)).toEqual({ start: 1, end: 5 });
  });
});

describe("getDefaultIndexFromLineText", () => {
  test("extracts the subscript of the given path", () => {
    expect(getDefaultIndexFromLineText("buf[i] = 1;", "buf")).toBe("i");
    expect(getDefaultIndexFromLineText("arr [ 3 ] = 0;", "arr")).toBe("3");
    expect(getDefaultIndexFromLineText("s.arr[k + 1]++;", "s.arr")).toBe(
      "k + 1"
    );
  });

  test("returns empty when the path is not subscripted", () => {
    expect(getDefaultIndexFromLineText("x = buf;", "buf")).toBe("");
    // "buffer" must not match "buf"
    expect(getDefaultIndexFromLineText("buffer[2] = 0;", "buf")).toBe("");
  });
});

describe("findFunctionBounds", () => {
  const lines = [
    "#include <x.h>",
    "",
    "void Manager::AddIncludedDessert(OrderType* Order)",
    "{",
    "  if (!Order) {",
    "    return;",
    "  }",
    "}",
    "",
    "void Other() { }",
  ];

  test("finds the body of the named function", () => {
    expect(findFunctionBounds(lines, "Manager::AddIncludedDessert")).toEqual({
      start: 3,
      end: 8,
    });
  });

  test("handles a one-line body", () => {
    expect(findFunctionBounds(lines, "Other")).toEqual({ start: 10, end: 10 });
  });

  test("falls back to the whole file when the function is unknown", () => {
    expect(findFunctionBounds(lines, "Nope")).toEqual({ start: 1, end: 10 });
    expect(findFunctionBounds(lines)).toEqual({ start: 1, end: 10 });
  });

  test("returns the rest of the file when the body never closes", () => {
    const unclosed = ["void Leaky(int x)", "{", "  if (x) {"];
    expect(findFunctionBounds(unclosed, "Leaky")).toEqual({ start: 1, end: 3 });
  });
});

describe("computeClickableTokens", () => {
  const lines = [
    "void f(OrderType* Order) {",
    "  if (Order->Entree == Steak) { // Order is checked here",
    "  TableData.IsOccupied = true;",
    "  WaitingListSize++;",
    "}",
  ];

  test("marks known scalars, pointers and fields, skips by-value structs", () => {
    const tokens = computeClickableTokens(lines, 1, lines.length, demoLookup());
    const paths = tokens.map((token) => `${token.line}:${token.path}`);

    expect(paths).toContain("1:Order");
    expect(paths).toContain("2:Order");
    expect(paths).toContain("2:Order.Entree");
    expect(paths).toContain("3:TableData.IsOccupied");
    expect(paths).toContain("4:WaitingListSize");

    // By-value struct itself is not assignable
    expect(paths).not.toContain("3:TableData");
    // Unknown bare identifiers are not clickable
    expect(paths).not.toContain("2:Steak");
    expect(paths).not.toContain("1:OrderType");
  });

  test("ignores identifiers inside a line comment", () => {
    const tokens = computeClickableTokens(lines, 2, 2, demoLookup());
    const orderTokens = tokens.filter((token) => token.path === "Order");
    expect(orderTokens).toHaveLength(1);
    expect(orderTokens[0].start).toBe(lines[1].indexOf("Order"));
  });

  test("unknown field accesses are still clickable", () => {
    const tokens = computeClickableTokens(
      ["  Order->Mystery = 3;"],
      1,
      1,
      demoLookup()
    );
    const mystery = tokens.find((token) => token.path === "Order.Mystery");
    expect(mystery).toBeDefined();
    expect(mystery?.kind).toBe("unknown");
  });

  test("skips empty lines within the requested range", () => {
    const tokens = computeClickableTokens(
      ["", "WaitingListSize++;"],
      1,
      2,
      demoLookup()
    );
    expect(tokens.map((token) => token.path)).toEqual(["WaitingListSize"]);
  });

  test("respects the requested line range and reports columns", () => {
    const tokens = computeClickableTokens(lines, 4, 4, demoLookup());
    expect(tokens).toEqual([
      {
        line: 4,
        start: 2,
        end: 2 + "WaitingListSize".length,
        path: "WaitingListSize",
        displayType: "unsigned",
        kind: "int",
      },
    ]);
  });
});

describe("flattenLookup", () => {
  test("lists assignable paths, grouped parameters first, without by-value structs", () => {
    const flat = flattenLookup(demoLookup());
    const paths = flat.map((known) => known.path);
    expect(paths).toEqual([
      "Order",
      "Order.Dessert",
      "Order.Entree",
      "TableData.IsOccupied",
      "WaitingListSize",
    ]);
    expect(
      flat.find((known) => known.path === "Order.Entree")?.enumValues
    ).toEqual(["Steak", "Chicken"]);
    expect(flat.find((known) => known.path === "WaitingListSize")?.group).toBe(
      "global"
    );
  });
});

describe("lookupPath", () => {
  test("resolves nested paths and misses cleanly", () => {
    const lookup = demoLookup();
    expect(lookupPath(lookup, "Order.Entree")?.kind).toBe("enum");
    expect(lookupPath(lookup, "Order.Nope")).toBeNull();
    expect(lookupPath(lookup, "Nope")).toBeNull();
  });
});

describe("buildLookupFromNodes", () => {
  test("skips a missing node list, invalid nodes and defaults fields", () => {
    const lookup = new Map<string, VariableInfo>();
    buildLookupFromNodes(undefined, lookup);
    expect(lookup.size).toBe(0);

    buildLookupFromNodes(
      [undefined, { displayType: "int" }, { name: 42 }, { name: "Bare" }],
      lookup,
      "global"
    );
    expect([...lookup.keys()]).toEqual(["Bare"]);
    expect(lookup.get("Bare")?.displayType).toBe("");
    expect(lookup.get("Bare")?.kind).toBe("unknown");
  });
});

describe("buildVariableValues", () => {
  test("expands array entries and drops blanks", () => {
    const selected = new Map();
    selected.set("Order.Entree", {
      displayType: "",
      kind: "enum",
      enumValues: [],
      value: " Steak ",
      entries: [],
    });
    selected.set("Skipped", {
      displayType: "",
      kind: "int",
      enumValues: [],
      value: "   ",
      entries: [],
    });
    selected.set("buf", {
      displayType: "",
      kind: "array",
      enumValues: [],
      value: "",
      entries: [
        { index: "0", value: "7" },
        { index: "", value: "9" },
        { index: "2", value: "" },
        { index: " 3 ", value: " 11 " },
      ],
    });
    expect(buildVariableValues(selected)).toEqual([
      { name: "Order.Entree", value: "Steak" },
      { name: "buf[0]", value: "7" },
      { name: "buf[3]", value: "11" },
    ]);
  });
});

describe("choosePreviewWindow", () => {
  test("shows the whole function when it is short", () => {
    expect(choosePreviewWindow(10, 50, 20)).toEqual({ start: 10, end: 50 });
  });

  test("clamps long functions to a window that contains the target", () => {
    const clamped = choosePreviewWindow(1, 2000, 1500, 400);
    expect(clamped.end - clamped.start + 1).toBe(400);
    expect(clamped.start).toBeLessThanOrEqual(1500);
    expect(clamped.end).toBeGreaterThanOrEqual(1500);

    const tail = choosePreviewWindow(1, 2000, 1990, 400);
    expect(tail).toEqual({ start: 1601, end: 2000 });

    const head = choosePreviewWindow(1, 2000, 5, 400);
    expect(head).toEqual({ start: 1, end: 400 });
  });
});
