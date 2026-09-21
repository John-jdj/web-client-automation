"use client";

import { useState } from "react";
import Link from "next/link";

interface DemoActionsProps {
  leadId: string;
  qualified: boolean;
  initialDemo: { id: string; status: string; slug: string } | null;
}

export default function DemoActions({ leadId, qualified, initialDemo }: DemoActionsProps) {
  const [demo, setDemo] = useState(initialDemo);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleGenerate(regenerate: boolean) {
    setGenerating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/demos/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, regenerate }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMessage(data.error ?? "Demo generation failed.");
        return;
      }
      setDemo({ id: data.demoId, status: data.status, slug: data.slug });
      setMessage(
        data.alreadyGenerated
          ? "Already generated."
          : `Generated using ${data.usedMock ? "DEMO_MODE mock content" : "Claude"} (${data.templateName} template).`
      );
    } finally {
      setGenerating(false);
    }
  }

  if (!qualified) {
    return (
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        This lead must be qualified before a demo can be generated.
      </p>
    );
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => handleGenerate(false)}
          disabled={generating}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {generating ? "Generating..." : demo ? "Regenerate Demo" : "Generate Demo"}
        </button>
        {demo && (
          <Link
            href={`/demo/${demo.id}`}
            target="_blank"
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
          >
            Preview Demo →
          </Link>
        )}
      </div>
      {message && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{message}</p>}
      {demo && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Status: {demo.status}</p>}
    </div>
  );
}
