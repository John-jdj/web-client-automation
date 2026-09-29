"use client";

import { useState } from "react";

interface OutreachMessageState {
  id: string;
  status: string;
  recipientEmail: string;
  subject: string;
  body: string;
  demoUrl: string | null;
}

interface OutreachActionsProps {
  leadId: string;
  eligible: boolean;
  initialMessage: OutreachMessageState | null;
}

export default function OutreachActions({ leadId, eligible, initialMessage }: OutreachActionsProps) {
  const [message, setMessage] = useState(initialMessage);
  const [generating, setGenerating] = useState(false);
  const [acting, setActing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setNote(null);
    try {
      const res = await fetch("/api/outreach/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setNote(data.error ?? "Outreach generation failed.");
        return;
      }
      setMessage({
        id: data.messageId,
        status: data.status,
        recipientEmail: data.recipientEmail,
        subject: data.subject,
        body: data.body,
        demoUrl: data.demoUrl,
      });
      setNote(
        data.alreadyGenerated
          ? "A draft already exists."
          : `Draft generated using ${data.usedMock ? "DEMO_MODE mock content" : "Claude"}.`
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleAction(action: "approve" | "reject" | "send") {
    if (!message) return;
    setActing(true);
    setNote(null);
    try {
      const res = await fetch(`/api/outreach/${message.id}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setNote(data.error ?? `Could not ${action} this message.`);
        if (data.status) setMessage({ ...message, status: data.status });
        return;
      }
      setMessage({ ...message, status: data.status });
      setNote(
        action === "approve"
          ? "Approved — ready to send."
          : action === "reject"
            ? "Draft rejected."
            : "Sent."
      );
    } finally {
      setActing(false);
    }
  }

  if (!eligible) {
    return (
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        This lead must be qualified, with a valid recipient email and no suppression match, before
        outreach can be generated.
      </p>
    );
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleGenerate}
          disabled={generating || Boolean(message)}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {generating ? "Generating..." : "Generate Outreach"}
        </button>

        {message && message.status === "DRAFT" && (
          <>
            <button
              onClick={() => handleAction("approve")}
              disabled={acting}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700"
            >
              Approve
            </button>
            <button
              onClick={() => handleAction("reject")}
              disabled={acting}
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-40 dark:border-red-900 dark:text-red-400"
            >
              Reject
            </button>
          </>
        )}

        {message && message.status === "QUEUED" && (
          <button
            onClick={() => handleAction("send")}
            disabled={acting}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
          >
            {acting ? "Sending..." : "Send"}
          </button>
        )}
      </div>

      {note && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{note}</p>}

      {message && (
        <div className="mt-3 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Status: <span className="font-medium">{message.status}</span> · To: {message.recipientEmail}
          </p>
          <p className="mt-2 font-medium text-zinc-900 dark:text-zinc-50">{message.subject}</p>
          <p className="mt-1 whitespace-pre-line text-zinc-700 dark:text-zinc-300">{message.body}</p>
          {message.demoUrl && (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Demo URL: {message.demoUrl}</p>
          )}
        </div>
      )}
    </div>
  );
}
