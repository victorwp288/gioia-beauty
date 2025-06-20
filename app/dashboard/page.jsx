"use client";
import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase/config";
import { onAuthStateChanged } from "firebase/auth";
import { DashboardSkeleton } from "@/components/common/LoadingSkeletons";

// Lazy load dashboard components for better performance
const DashyComponent = dynamic(() => import("@/components/dashboard/Dashy"), {
  loading: () => <DashboardSkeleton />,
  ssr: false, // Dashboard is admin-only, no need for SSR
});

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    console.log("🔐 Dashboard: Setting up auth state listener...");

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log(
        "🔐 Dashboard: Auth state changed:",
        user ? { uid: user.uid, email: user.email } : "No user"
      );

      setUser(user);
      setAuthLoading(false);

      if (!user) {
        console.log("🔐 Dashboard: No user found, redirecting to login...");
        router.replace("/login");
      } else {
        console.log(
          "✅ Dashboard: User authenticated, proceeding to dashboard"
        );
      }
    });

    return () => {
      console.log("🔐 Dashboard: Cleaning up auth listener");
      unsubscribe();
    };
  }, [router]);

  // Render lazy-loaded dashboard component
  // This reduces initial bundle size for non-admin users
  return (
    <div className="min-h-screen">
      <DashyComponent user={user} authLoading={authLoading} />
    </div>
  );
}
