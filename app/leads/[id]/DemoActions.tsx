"use client";

import { useState } from "react";
import Link from "next/link";

interface DemoActionsProps {
  leadId: string;
  qualified: boolean;
  initialDemo: { id: string; status: string; slug: string } | null;
  initialDeployment: { deploymentUrl: string | null; status: string } | null;
}

export default function DemoActions({
  leadId,
  qualified,
  initialDemo,
  initialDeployment,
}: DemoActionsProps) {
  const [demo, setDemo] = useState(initialDemo);
  const [deployment, setDeployment] = useState(initialDeployment);
  const [generating, setGenerating] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deployMessage, setDeployMessage] = useState<string | null>(null);

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
      // A fresh generation supersedes any prior deployment's content.
      setDeployment(null);
      setDeployMessage(null);
      setMessage(
        data.alreadyGenerated
          ? "Already generated."
          : `Generated using ${data.usedMock ? "DEMO_MODE mock content" : "Claude"} (${data.templateName} template).`
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeploy() {
    if (!demo) return;
    setDeploying(true);
    setDeployMessage(null);
    try {
      const res = await fetch(`/api/demos/${demo.id}/deploy`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setDeployMessage(data.error ?? "Demo deployment failed.");
        return;
      }
      setDeployment({ deploymentUrl: data.deploymentUrl, status: data.status });
      setDeployMessage(
        data.alreadyDeployed
          ? "Already deployed."
          : `Deployed using ${data.usedMock ? "DEMO_MODE mock deployment" : "Vercel"}.`
      );
    } finally {
      setDeploying(false);
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
        {demo && (
          <button
            onClick={handleDeploy}
            disabled={deploying}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700"
          >
            {deploying ? "Deploying..." : deployment ? "Redeploy Demo" : "Deploy Demo"}
          </button>
        )}
      </div>

      {message && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{message}</p>}
      {demo && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Status: {demo.status}</p>}

      {deployMessage && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{deployMessage}</p>}
      {deployment && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Deployment status: {deployment.status}
          {deployment.deploymentUrl && deployment.status === "READY" && (
            <>
              {" — "}
              <a
                href={deployment.deploymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
              >
                {deployment.deploymentUrl}
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
