// Stages outbound iMessage attachments onto the Messages Mac for remote SSH cliPath setups.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

// Remote imsg can only open files on the Messages Mac, so a gateway-local path is
// copied there first. Files are left in the Mac /tmp for macOS periodic cleanup:
// Messages uploads asynchronously after imsg returns, so deleting right after the
// send would race the transfer.
const REMOTE_OUTBOUND_DIR = "/tmp";
const SCP_STDERR_TAIL_CHARS = 2_000;

/** Copies a gateway-local attachment to the Messages Mac and returns its remote path. */
export async function stageIMessageAttachmentOnRemote(params: {
  remoteHost: string;
  localPath: string;
}): Promise<string> {
  // Keep the extension (Messages picks the preview type from it) but only
  // shell-safe characters, since scp re-parses the remote path on the far side.
  const safeName = path.basename(params.localPath).replace(/[^A-Za-z0-9._-]/g, "_");
  const remotePath = `${REMOTE_OUTBOUND_DIR}/openclaw-imessage-${randomUUID()}-${safeName}`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "scp",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "--",
        params.localPath,
        `${params.remoteHost}:${remotePath}`,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-SCP_STDERR_TAIL_CHARS);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`scp to ${params.remoteHost} failed (exit ${code}): ${stderr.trim()}`));
    });
  });
  return remotePath;
}
