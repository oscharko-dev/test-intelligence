import { describe, expect, it } from "vitest";

import { createMemoryWorkbenchStorageAdapter } from "@/lib/server/storage";

import { runWorkbenchStorageAdapterContract } from "./adapter-contract";

runWorkbenchStorageAdapterContract(
  "MemoryWorkbenchStorageAdapter",
  createMemoryWorkbenchStorageAdapter,
);

describe("MemoryWorkbenchStorageAdapter specifics", () => {
  it("assigns distinct ids to successive records", () => {
    const adapter = createMemoryWorkbenchStorageAdapter();
    const first = adapter.runs.create({ tenantScope: "t", status: "queued" });
    const second = adapter.runs.create({ tenantScope: "t", status: "queued" });
    expect(first.id).not.toBe(second.id);
  });

  it("clears all stored records on close", () => {
    const adapter = createMemoryWorkbenchStorageAdapter();
    adapter.runs.create({ tenantScope: "t", status: "queued" });
    adapter.snapshots.create({
      tenantScope: "t",
      source: "figma:key",
      nodeCount: 1,
      pageCount: 1,
      frameCount: 1,
      lifecycleState: "imported",
    });
    adapter.close();
    expect(adapter.runs.list()).toStrictEqual([]);
    expect(adapter.snapshots.list()).toStrictEqual([]);
  });
});
