import { describe, it, expect } from "vitest";
import { test, fc } from "@fast-check/vitest";
import { csvEscape, csvCents, csvRow, csvDocumentBytes } from "./csv";

describe("csvEscape", () => {
  it("quotes values containing commas, quotes or newlines", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("two\nlines")).toBe('"two\nlines"');
    expect(csvEscape("plain")).toBe("plain");
  });

  it("neutralises spreadsheet formulas (CSV injection)", () => {
    for (const value of ["=HYPERLINK(\"x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) {
      const escaped = csvEscape(value);
      expect(escaped.replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvEscape("=1,2")).toBe(`"'=1,2"`);
  });

  test.prop([fc.string()])("never emits a cell a spreadsheet would evaluate", (value) => {
    const cell = csvEscape(value).replace(/^"/, "");
    expect(/^[=+\-@\t\r]/.test(cell)).toBe(false);
  });
});

describe("csvCents", () => {
  it("renders integer cents as dollars with two decimals", () => {
    expect(csvCents(-1250)).toBe("-12.50");
    expect(csvCents(500000)).toBe("5000.00");
    expect(csvCents(0)).toBe("0.00");
    expect(csvCents(-0)).toBe("0.00");
  });
});

describe("csvRow / csvDocumentBytes", () => {
  it("joins cells and prefixes a UTF-8 BOM", () => {
    expect(csvRow(["a", "b,c"])).toBe('a,"b,c"');
    const bytes = csvDocumentBytes(["h1,h2", "x,y"]);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe("h1,h2\nx,y\n");
  });
});
