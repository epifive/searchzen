"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** "Download PDF": the browser's print dialog, where "Save as PDF" is the destination. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button onClick={() => window.print()} size="sm">
      <Download aria-hidden />
      {label}
    </Button>
  );
}
