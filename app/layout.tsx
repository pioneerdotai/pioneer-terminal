import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pioneer Terminal",
  description: "Host terminal sessions through Pioneer Gateway",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const reference = (await headers()).get("Pioneer-App-Base-Path") ?? "./";
  const base = /^(?:\.\/|(?:\.\.\/)+)$/.test(reference) ? reference : "./";
  return (
    <html lang="en">
      <head>
        <base href={base} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
