import type {
  ComparisonOperator,
  FieldDefinition,
  ValueKind,
} from "./types";

const allComparisons: readonly ComparisonOperator[] = [
  "=",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
];
const timeComparisons: readonly ComparisonOperator[] = [
  "=",
  "<",
  "<=",
  ">",
  ">=",
];
const openTimeComparisons: readonly ComparisonOperator[] = ["<", "<=", ">", ">="];
const equality: readonly ComparisonOperator[] = ["=", "!="];
const onlyEquals: readonly ComparisonOperator[] = ["="];

function field(
  name: string,
  label: string,
  description: string,
  valueKind: ValueKind,
  operators: readonly ComparisonOperator[] = allComparisons,
  values?: readonly string[],
  aliases?: readonly string[],
): FieldDefinition {
  return {
    name,
    label,
    description,
    valueKind,
    operators,
    ...(values ? { values } : {}),
    ...(aliases ? { aliases } : {}),
  };
}

/** Compatibility catalog derived from Beads' query parser/evaluator. */
export const FIELD_DEFINITIONS: readonly FieldDefinition[] = [
  field("status", "Status", "Stored issue status", "enum", equality, [
    "open",
    "in_progress",
    "blocked",
    "deferred",
    "closed",
  ]),
  field("priority", "Priority", "Priority level from 0 (highest) to 4", "number", ["=", "<", "<=", ">", ">="]),
  field("type", "Type", "Issue type", "enum", equality, [
    "bug",
    "feature",
    "task",
    "epic",
    "chore",
    "decision",
  ]),
  field("assignee", "Assignee", "Assigned user; use none for unassigned", "text", onlyEquals),
  field("owner", "Owner", "Issue owner", "text", onlyEquals),
  field("label", "Label", "Issue label; use none for unlabeled", "text", onlyEquals, undefined, ["labels"]),
  field("title", "Title", "Search in the issue title", "text", onlyEquals),
  field("description", "Description", "Search in the description", "text", onlyEquals, undefined, ["desc"]),
  field("notes", "Notes", "Search in issue notes", "text", onlyEquals),
  field("created", "Created", "Creation date or relative time", "date", timeComparisons, undefined, ["created_at"]),
  field("updated", "Updated", "Last update date or relative time", "date", timeComparisons, undefined, ["updated_at"]),
  field("started", "Started", "First transition to in progress", "date", openTimeComparisons, undefined, ["started_at"]),
  field("closed", "Closed", "Close date or relative time", "date", openTimeComparisons, undefined, ["closed_at"]),
  field("id", "ID", "Issue ID; equality supports a trailing wildcard", "identifier", equality),
  field("spec", "Spec", "Specification ID; equality supports a trailing wildcard", "identifier", equality, undefined, ["spec_id"]),
  field("pinned", "Pinned", "Whether the issue is pinned", "boolean", onlyEquals, ["true", "false", "yes", "no", "1", "0"]),
  field("ephemeral", "Ephemeral", "Whether the issue is ephemeral", "boolean", onlyEquals, ["true", "false", "yes", "no", "1", "0"]),
  field("template", "Template", "Whether the issue is a template", "boolean", onlyEquals, ["true", "false", "yes", "no", "1", "0"]),
  field("parent", "Parent", "Parent issue ID", "identifier", onlyEquals),
  field("mol_type", "Molecule type", "Molecule type", "enum", onlyEquals, ["swarm", "patrol", "work"]),
  field("has_metadata_key", "Has metadata key", "Test for a metadata key", "identifier", onlyEquals),
];

const byName = new Map<string, FieldDefinition>();
for (const definition of FIELD_DEFINITIONS) {
  byName.set(definition.name, definition);
  for (const alias of definition.aliases ?? []) byName.set(alias, definition);
}

export function canonicalFieldName(value: string): string {
  const lower = value.toLowerCase();
  if (lower.startsWith("metadata.")) {
    return `metadata.${value.slice("metadata.".length)}`;
  }
  return byName.get(lower)?.name ?? lower;
}

export function fieldDefinition(value: string): FieldDefinition | undefined {
  const lower = value.toLowerCase();
  if (lower.startsWith("metadata.") && value.length > "metadata.".length) {
    return field(
      value,
      "Metadata field",
      "A dynamic metadata key; Beads supports equality only",
      "text",
      onlyEquals,
    );
  }
  return byName.get(lower);
}

export function allFieldNames(): readonly string[] {
  return [...byName.keys()].sort();
}

export const BOOLEAN_KEYWORDS = ["AND", "OR", "NOT"] as const;
