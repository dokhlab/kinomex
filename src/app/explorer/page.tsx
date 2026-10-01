import { Suspense } from "react";
import ExplorerClient from "./ExplorerClient";

export default function ExplorerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <ExplorerClient />
    </Suspense>
  );
}
