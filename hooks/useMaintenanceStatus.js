"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getMaintenanceStatus } from "@/lib/client/maintenanceApi.ts";

const REFRESH_INTERVAL_MS = 30_000;

export function useMaintenanceStatus() {
  const [status, setStatus] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const controllerRef = useRef(null);

  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const nextStatus = await getMaintenanceStatus(controller.signal);
      if (!controller.signal.aborted) {
        setStatus(nextStatus);
        setUnavailable(false);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus(null);
        setUnavailable(true);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      controllerRef.current?.abort();
    };
  }, [refresh]);

  return {
    publicBookingEnabled: status?.publicBookingEnabled === true,
    ownerMutationsEnabled: status?.ownerMutationsEnabled === true,
    messageCode: status?.messageCode ?? null,
    unavailable,
    refresh,
  };
}
