import { describe, expect, it } from "vitest";
import {
  readStoredBeadsProjectId,
  writeStoredBeadsProjectId,
} from "../../project-context";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("stored Beads project selection", () => {
  it("round-trips a manually selected project", () => {
    const state = storage();

    writeStoredBeadsProjectId(state, "proj-two");

    expect(readStoredBeadsProjectId(state)).toBe("proj-two");
  });

  it("clears the stored selection", () => {
    const state = storage();
    writeStoredBeadsProjectId(state, "proj-two");

    writeStoredBeadsProjectId(state, null);

    expect(readStoredBeadsProjectId(state)).toBeNull();
  });

  it("fails closed when browser storage is unavailable", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
      removeItem: () => {
        throw new Error("storage unavailable");
      },
    };

    expect(readStoredBeadsProjectId(unavailable)).toBeNull();
    expect(() => writeStoredBeadsProjectId(unavailable, "proj-two")).not.toThrow();
  });
});
