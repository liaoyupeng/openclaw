// Imessage tests cover remote outbound attachment staging.
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stageIMessageAttachmentOnRemote } from "./remote-outbound-media.js";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock,
}));

function fakeScp(exitCode: number, stderr = "") {
  const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
  queueMicrotask(() => {
    if (stderr) {
      child.stderr.emit("data", Buffer.from(stderr));
    }
    child.emit("close", exitCode);
  });
  return child;
}

describe("stageIMessageAttachmentOnRemote", () => {
  afterEach(() => {
    spawnMock.mockReset();
  });

  it("copies the file to the Mac /tmp with a shell-safe unique name", async () => {
    spawnMock.mockImplementation(() => fakeScp(0));

    const remotePath = await stageIMessageAttachmentOnRemote({
      remoteHost: "bot@messages-mac",
      localPath: "/home/bot/.openclaw/media/语音 reply.ogg",
    });

    expect(remotePath).toMatch(/^\/tmp\/openclaw-imessage-[0-9a-f-]{36}-[A-Za-z0-9._-]+\.ogg$/);
    const [command, args] = spawnMock.mock.calls[0] ?? [];
    expect(command).toBe("scp");
    expect(args).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "--",
      "/home/bot/.openclaw/media/语音 reply.ogg",
      `bot@messages-mac:${remotePath}`,
    ]);
  });

  it("surfaces scp failures with the stderr tail", async () => {
    spawnMock.mockImplementation(() => fakeScp(1, "Host key verification failed."));

    await expect(
      stageIMessageAttachmentOnRemote({ remoteHost: "bot@messages-mac", localPath: "/tmp/a.png" }),
    ).rejects.toThrow("scp to bot@messages-mac failed (exit 1): Host key verification failed.");
  });
});
