"use client";

export function CopyNotice({ copyStatus }: { copyStatus: string }) {
  return copyStatus ? (
    <p role="status" className="pb-2 text-xs text-(--workspace-muted)">{copyStatus}</p>
  ) : null;
}

export function ConnectionNotices({
  reconnected,
  lostInput,
  connectionMessage,
  onDismiss,
}: {
  reconnected: boolean;
  lostInput: boolean;
  connectionMessage: string | null;
  onDismiss: () => void;
}) {
  return (
    <>
      {(reconnected || lostInput) && (
        <div
          role="status"
          className="flex items-center gap-3 py-2 text-xs text-(--workspace-muted)"
        >
          <span>
            {reconnected && "Reconnected."}
            {lostInput &&
              " Some input did not reach the shell and was not resent. Check the command line before continuing."}
          </span>
          <button
            type="button"
            className="shrink-0 underline hover:text-(--workspace-fg)"
            onClick={onDismiss}
            aria-label="Dismiss reconnection notice"
          >
            Dismiss
          </button>
        </div>
      )}
      {connectionMessage && (
        <p
          role="status"
          className="shrink-0 px-2 py-1 text-xs text-(--workspace-muted)"
        >
          {connectionMessage}
        </p>
      )}
    </>
  );
}
