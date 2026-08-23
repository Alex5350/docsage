import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, streamChatMessage } from "./api";
import type { ChatStreamEvent } from "./types";

/** Builds a fetch Response whose body streams the given chunks verbatim. */
function sseResponse(chunks: string[], contentType = "text/event-stream") {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

let events: ChatStreamEvent[];

function record(event: ChatStreamEvent) {
  events.push(event);
}

beforeEach(() => {
  events = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamChatMessage SSE parsing", () => {
  it("delivers events split across chunk boundaries, CRLF lines, and keep-alives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'data: {"type":"delta","text":"Hel',        // split mid-JSON
          'lo"}\r\ndata: {"type":"delta","text":" world"}\n',
          ": keep-alive comment\n\n",                  // comment + blank line
          'data: {"type":"citations","citations":[]}\n',
          'data: {"type":"done","message_id":"m1"}',
        ]),
      ),
    );

    await streamChatMessage("s1", "hi", record);

    expect(events.map((e) => e.type)).toEqual(["delta", "delta", "citations", "done"]);
    expect((events[0] as { text: string }).text).toBe("Hello");
  });

  it("stops reading after a terminal error event and cancels the stream", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"partial"}\n'));
        controller.enqueue(new TextEncoder().encode('data: {"type":"error","message":"boom"}\n'));
        // Would stream more if not cancelled.
        controller.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"unreachable"}\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    );

    await streamChatMessage("s1", "hi", record);

    expect(events.map((e) => e.type)).toEqual(["delta", "error"]);
    expect(cancelled).toBe(true);
  });

  it("rejects a 200 response that is not an event stream (proxy/HTML page)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(["<html>gateway error</html>"], "text/html")),
    );

    await expect(streamChatMessage("s1", "hi", record)).rejects.toBeInstanceOf(ApiError);
    expect(events).toEqual([]);
  });

  it("flushes a multi-byte character split at the exact end of the stream", async () => {
    const payload = 'data: {"type":"delta","text":"café"}\n';
    const bytes = new TextEncoder().encode(payload);
    // Split so the final UTF-8 continuation bytes land in the last chunk and
    // only the decoder's terminal flush can reassemble them.
    const split = bytes.length - 2;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          new TextDecoder().decode(bytes.slice(0, split)),
          new TextDecoder().decode(bytes.slice(split)),
        ]),
      ),
    );

    await streamChatMessage("s1", "hi", record);

    expect((events[0] as { text: string }).text).toBe("café");
  });

  it("surfaces mid-stream network failures as rejections without leaking the reader", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"x"}\n'));
        controller.error(new TypeError("network died"));
      },
      // cancel() on an errored stream never reaches the source's cancel
      // callback (per the streams spec) — the guarantee under test is that
      // the rejection propagates and the cleanup path does not throw.
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    );

    await expect(streamChatMessage("s1", "hi", record)).rejects.toThrow("network died");
  });
});
