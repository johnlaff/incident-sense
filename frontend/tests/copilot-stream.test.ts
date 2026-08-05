import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseCopilotStream,
  StreamContractError,
  type StreamErrorCode,
} from "@/lib/copilot-stream";

const fixturesDir = path.resolve(__dirname, "../../contracts/copilot-stream");

interface Fixture {
  description: string;
  chunks: string[];
  expect:
    | { outcome: "ok"; event_count: number; terminal_type: string }
    | { outcome: "error"; error_code: StreamErrorCode };
}

function loadFixtures(subdir: "valid" | "invalid"): Array<{ name: string; fixture: Fixture }> {
  const dir = path.join(fixturesDir, subdir);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({
      name,
      fixture: JSON.parse(readFileSync(path.join(dir, name), "utf-8")) as Fixture,
    }));
}

describe("parseCopilotStream — valid fixtures", () => {
  it.each(loadFixtures("valid"))("$name accepts the stream", ({ fixture }) => {
    const events = parseCopilotStream(fixture.chunks);
    expect(fixture.expect.outcome).toBe("ok");
    if (fixture.expect.outcome !== "ok") return;

    expect(events).toHaveLength(fixture.expect.event_count);

    const terminal = events[events.length - 1];
    expect(terminal.type).toBe(fixture.expect.terminal_type);
  });

  it("narrows the diagnosis block of full-turn-grounded.json to non-empty citations", () => {
    const { fixture } = loadFixtures("valid").find((f) => f.name === "full-turn-grounded.json")!;
    const events = parseCopilotStream(fixture.chunks);
    const terminal = events[events.length - 1];

    if (terminal.type !== "answer.completed") {
      throw new Error("expected answer.completed as terminal event");
    }

    const diagnosis = terminal.answer.blocks.find((block) => block.type === "diagnosis");
    expect(diagnosis).toBeDefined();
    if (diagnosis?.type !== "diagnosis") throw new Error("expected diagnosis block");
    expect(diagnosis.citations.length).toBeGreaterThan(0);

    const action = terminal.answer.blocks.find((block) => block.type === "action");
    if (action?.type !== "action") throw new Error("expected action block");
    expect(action.citations.length).toBeGreaterThan(0);
  });
});

describe("parseCopilotStream — invalid fixtures", () => {
  it.each(loadFixtures("invalid"))(
    "$name rejects with the expected error code",
    ({ fixture }) => {
      expect(fixture.expect.outcome).toBe("error");
      if (fixture.expect.outcome !== "error") return;

      try {
        parseCopilotStream(fixture.chunks);
        throw new Error("expected parseCopilotStream to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(StreamContractError);
        expect((error as StreamContractError).code).toBe(fixture.expect.error_code);
      }
    },
  );
});
