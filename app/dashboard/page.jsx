"use client";
import React, { useEffect, useState } from "react";
import Dashy from "@/components/dashboard/Dashy";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase/config";
import { onAuthStateChanged } from "firebase/auth";

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setAuthLoading(false);

      if (!user) {
        router.replace("/login");
      }
    });

    return () => unsubscribe();
  }, [router]);

  // Always render Dashy - it will handle its own loading state
  // This prevents the component from unmounting/remounting
  return <Dashy user={user} authLoading={authLoading} />;
}
