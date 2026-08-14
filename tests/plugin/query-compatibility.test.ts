import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { analyze, parse } from "../../query-core";

const cli = process.env.BEADS_BIN ?? "bd";
const cwd = process.env.BEADS_COMPAT_CWD ?? process.cwd();
const enabled = process.env.BEADS_QUERY_COMPAT === "1";
const cliAvailable = spawnSync(cli, ["--version"], {
  cwd,
  encoding: "utf8",
  stdio: "ignore",
}).status !== null;

interface Fixture {
  expression: string;
  syntax: "valid" | "invalid";
  evaluation: "valid" | "invalid";
}

const fixtures: readonly Fixture[] = [
  { expression: "status=open", syntax: "valid", evaluation: "valid" },
  { expression: "priority=+1", syntax: "valid", evaluation: "valid" },
  { expression: "status=open AND priority>1", syntax: "valid", evaluation: "valid" },
  { expression: "(status=open OR status=blocked) AND updated>7d", syntax: "valid", evaluation: "valid" },
  { expression: "NOT status=closed", syntax: "valid", evaluation: "valid" },
  { expression: "title=authentication AND priority=0", syntax: "valid", evaluation: "valid" },
  { expression: "metadata.Release=stable", syntax: "valid", evaluation: "valid" },
  { expression: "label=gt:merge-request", syntax: "valid", evaluation: "valid" },
  { expression: "has_metadata_key=Release", syntax: "valid", evaluation: "valid" },
  { expression: "status=", syntax: "invalid", evaluation: "invalid" },
  { expression: "status!open", syntax: "invalid", evaluation: "invalid" },
  { expression: "(status=open", syntax: "invalid", evaluation: "invalid" },
  { expression: "unknown=value", syntax: "valid", evaluation: "invalid" },
  { expression: "priority=9", syntax: "valid", evaluation: "invalid" },
  { expression: "pinned=maybe", syntax: "valid", evaluation: "invalid" },
  { expression: "metadata.Release>stable", syntax: "valid", evaluation: "invalid" },
  { expression: "status>open", syntax: "valid", evaluation: "invalid" },
  { expression: "priority!=1", syntax: "valid", evaluation: "invalid" },
  { expression: "assignee!=alice", syntax: "valid", evaluation: "invalid" },
  { expression: "pinned!=true", syntax: "valid", evaluation: "invalid" },
  { expression: "started=tomorrow", syntax: "valid", evaluation: "invalid" },
];

function runBd(args: readonly string[]) {
  return spawnSync(cli, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
}

describe.skipIf(!enabled || !cliAvailable)("Beads query CLI compatibility", () => {
  it("keeps syntax acceptance aligned with bd --parse-only", () => {
    for (const fixture of fixtures) {
      const core = parse(fixture.expression);
      const result = runBd(["query", "--parse-only", fixture.expression]);
      expect(core.diagnostics.length > 0, fixture.expression).toBe(
        fixture.syntax === "invalid",
      );
      expect(result.status === 0, `${fixture.expression}\n${result.stderr}`).toBe(
        fixture.syntax === "valid",
      );
    }
  });

  it("keeps semantic acceptance aligned with bd query execution", () => {
    for (const fixture of fixtures) {
      const result = runBd(["query", "--json", fixture.expression]);
      const succeeded = result.status === 0;
      expect(succeeded, `${fixture.expression}\n${result.stderr}\n${result.stdout}`).toBe(
        fixture.evaluation === "valid",
      );
      if (fixture.evaluation === "valid") {
        expect(() => JSON.parse(result.stdout)).not.toThrow();
      }
    }
  });
});
