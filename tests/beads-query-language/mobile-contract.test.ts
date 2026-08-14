import { describe, expect, it } from "vitest";
import {
  MOBILE_QUERY_ASSIST_CONTRACT,
  MOBILE_QUERY_ASSIST_EXAMPLES,
  type MobileQueryAssistEvent,
  type MobileQueryAssistState,
} from "../../beads-query-language/mobile-contract";

describe("mobile query assistance contract", () => {
  it("defines portable input, focus, IME, and surface state", () => {
    const state: MobileQueryAssistState = {
      mode: "raw",
      inputState: "query-incomplete",
      source: "status=",
      cursor: 7,
      focus: "composing",
      keyboard: "visible",
      surface: "none",
      imeComposing: true,
    };
    const event: MobileQueryAssistEvent = {
      type: "composition-update",
      source: "status=開",
      cursor: 9,
    };

    expect(state.imeComposing).toBe(true);
    expect(event.type).toBe("composition-update");
    expect(MOBILE_QUERY_ASSIST_CONTRACT.minTouchTargetCssPx).toBe(44);
    expect(MOBILE_QUERY_ASSIST_CONTRACT.completion.compositionPolicy).toBe("defer-during-ime");
  });

  it("makes completion, builder, and accessibility rules explicit", () => {
    expect(MOBILE_QUERY_ASSIST_CONTRACT.completion.replacementOffsets).toBe("utf16");
    expect(MOBILE_QUERY_ASSIST_CONTRACT.builder.emptyRowPolicy).toBe("omit");
    expect(MOBILE_QUERY_ASSIST_CONTRACT.builder.connectorPolicy).toBe("explicit-between-rows");
    expect(MOBILE_QUERY_ASSIST_CONTRACT.accessibility.inputRole).toBe("combobox");
    expect(MOBILE_QUERY_ASSIST_CONTRACT.accessibility.completionRole).toBe("listbox");
  });

  it("provides deterministic adapter scenarios", () => {
    expect(MOBILE_QUERY_ASSIST_EXAMPLES.map((example) => example.name)).toEqual([
      "field-to-value",
      "recover-invalid-query",
      "builder-with-connector",
    ]);
    expect(MOBILE_QUERY_ASSIST_EXAMPLES[0]).toMatchObject({
      source: "status=",
      expectedSelection: "open",
    });
  });
});
