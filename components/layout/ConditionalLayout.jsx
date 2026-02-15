// components/ConditionalLayout.jsx
"use client";

import { usePathname } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

export default function ConditionalLayout({ children }) {
  const pathname = usePathname();
  const hideLayoutPaths = ["/dashboard", "/login"];
  const hideLayout = hideLayoutPaths.includes(pathname);

  if (hideLayout) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}
