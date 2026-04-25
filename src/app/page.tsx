import { Suspense } from "react";

import { NazokuApp } from "@/components/nazoku-app";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <NazokuApp />
    </Suspense>
  );
}
