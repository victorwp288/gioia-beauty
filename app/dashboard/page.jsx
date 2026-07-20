"use client";
import React, { useEffect, useState } from "react";
import Dashy from "@/components/dashboard/Dashy";
import { useRouter } from "next/navigation";
import { AppointmentProvider } from "@/context/AppointmentContext";
import {
  getOwnerSession,
  OwnerApiError,
  ownerErrorMessage,
} from "@/lib/client/ownerApi.ts";

const OWNER_SESSION_USER = {
  owner: true,
};

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [sessionError, setSessionError] = useState("");

  useEffect(() => {
    let active = true;

    async function verifyOwnerSession() {
      try {
        await getOwnerSession();
        if (!active) return;
        setUser(OWNER_SESSION_USER);
        setSessionError("");
      } catch (error) {
        if (!active) return;
        setUser(null);
        if (
          error instanceof OwnerApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          router.replace("/login");
          return;
        }
        setSessionError(ownerErrorMessage(error));
      } finally {
        if (active) setAuthLoading(false);
      }
    }

    void verifyOwnerSession();

    return () => {
      active = false;
    };
  }, [router]);

  if (sessionError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        <div className="max-w-md text-center">
          <p className="text-red-700 dark:text-red-300" role="alert">
            {sessionError}
          </p>
          <button
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => window.location.reload()}
            type="button"
          >
            Riprova
          </button>
        </div>
      </div>
    );
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900 dark:border-gray-100" />
          <p className="mt-4 text-gray-600 dark:text-gray-300">
            {authLoading
              ? "Verifica autenticazione..."
              : "Reindirizzamento al login..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <AppointmentProvider>
      <Dashy user={user} authLoading={false} />
    </AppointmentProvider>
  );
}
