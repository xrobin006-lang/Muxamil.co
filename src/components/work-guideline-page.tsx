"use client";

import { AppProvider } from "@/components/work-guideline/provider";
import { AppShell } from "@/components/work-guideline/shell";
import WorkGuidelineRouter from "@/components/work-guideline/router-page";

export default function WorkGuidelinePage() {
  return (
    <div className="wg-root min-h-screen">
      <AppProvider>
        <AppShell>
          <WorkGuidelineRouter />
        </AppShell>
      </AppProvider>
    </div>
  );
}
