import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deployDemo, DeployDemoIneligibleError } from "@/lib/demo/deploy-demo";
import { DeploymentError } from "@/lib/vercel/errors";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Authentication required." },
      { status: 401 }
    );
  }

  const { id } = await params;

  try {
    const result = await deployDemo(id);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof DeployDemoIneligibleError) {
      const status = err.code === "DEMO_NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ success: false, error: err.message, code: err.code }, { status });
    }
    if (err instanceof DeploymentError) {
      const status =
        err.code === "MISSING_CREDENTIALS" || err.code === "AUTH_FAILED" || err.code === "ACCESS_DENIED"
          ? 502
          : err.code === "QUOTA_EXCEEDED"
            ? 429
            : 500;
      return NextResponse.json({ success: false, error: err.message, code: err.code }, { status });
    }

    console.error("Demo deployment failed:", err);
    return NextResponse.json(
      { success: false, error: "Demo deployment failed unexpectedly." },
      { status: 500 }
    );
  }
}
