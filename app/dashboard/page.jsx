"use client";
import React, { useEffect, useState } from "react";
import Dashy from "@/components/dashboard/Dashy";
import SubscriberList from "@/components/SubscriberList";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase/config";
import { onAuthStateChanged } from "firebase/auth";

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

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
          <p className="mt-4 text-gray-600">Checking authentication...</p>
        </div>
      </div>
    );
  }

  // Don't render dashboard if no user
  if (!user) {
    return null; // Will redirect to login
  }

  return (
    <div className="min-h-screen">
      <Dashy />
    </div>
  );
}
