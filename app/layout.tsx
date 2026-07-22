import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Khoot Mini ? ??u tr??ng t? v?ng",
  description: "Tr? ch?i t? v?ng nhanh d?nh cho nh?m 5 ng??i.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
