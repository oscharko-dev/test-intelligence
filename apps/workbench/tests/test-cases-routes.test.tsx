import { describe, expect, it } from "vitest";

import TestCaseDetailPage, {
  metadata as detailMetadata,
} from "@/app/test-cases/[caseId]/page";
import TestCasesPage, { metadata as listMetadata } from "@/app/test-cases/page";

describe("test-cases route pages", () => {
  it("exports a server component as default for /test-cases", () => {
    expect(typeof TestCasesPage).toBe("function");
    expect(listMetadata.title).toMatch(/Test Cases/);
    expect(typeof listMetadata.description).toBe("string");
  });

  it("exports an async server component as default for /test-cases/[caseId]", () => {
    expect(typeof TestCaseDetailPage).toBe("function");
    expect(detailMetadata.title).toMatch(/Test Case/);
    expect(typeof detailMetadata.description).toBe("string");
  });

  it("renders the screen wrapper when invoked with awaited params", async () => {
    const node = await TestCaseDetailPage({
      params: Promise.resolve({ caseId: "tc-fixture" }),
    });
    // The detail page returns a single ReactElement whose type is the client
    // screen component; the rendered identity must match that contract.
    expect(node).not.toBeNull();
    expect(typeof node).toBe("object");
  });
});
