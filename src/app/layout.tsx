import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Nazoku",
  description: "Multiplayer Sudoku for live rooms on Vercel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
