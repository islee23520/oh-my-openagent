const REPLY_LISTENER_DAEMON_IDENTITY_MARKER = "--openclaw-reply-listener-daemon"

interface ProcessProbe {
  readonly exitCode: number | null
  readonly exited: Promise<number>
  readonly stdout: ReadableStream<Uint8Array>
}

interface ReplyListenerProcessDeps {
  readonly spawn: (
    command: string[],
    options: { readonly stdout: "pipe"; readonly stderr: "ignore" },
  ) => ProcessProbe
  readonly platform?: typeof process.platform
  readonly readProcCmdline?: (pid: number) => string
}

interface ReplyListenerProcessMockState {
  readonly livePids: ReadonlySet<number>
  readonly daemonPids: ReadonlySet<number>
}

async function isReplyListenerDaemonProcessWithDeps(
  pid: number,
  deps: ReplyListenerProcessDeps,
): Promise<boolean> {
  const platform = deps.platform ?? process.platform
  if (platform === "linux" && deps.readProcCmdline !== undefined) {
    return deps.readProcCmdline(pid).includes(REPLY_LISTENER_DAEMON_IDENTITY_MARKER)
  }

  const processInfo = deps.spawn(["ps", "-p", String(pid), "-o", "args="], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const stdout = await new Response(processInfo.stdout).text()
  await processInfo.exited
  return processInfo.exitCode === 0 && stdout.includes(REPLY_LISTENER_DAEMON_IDENTITY_MARKER)
}

export function createReplyListenerProcessMock(state: ReplyListenerProcessMockState) {
  return {
    isReplyListenerProcessRunning: (pid: number) => state.livePids.has(pid),
    isReplyListenerDaemonProcess: async (pid: number) => state.daemonPids.has(pid),
    isReplyListenerDaemonProcessWithDeps,
  }
}
