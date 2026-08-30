"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { bookingContent } from "@/lib/content/bookingContent";

const PublicBookingNotificationContext = createContext(null);

const DEFAULT_DURATION_MS = 5_000;

function notificationStyles(type) {
  if (type === "error") {
    return "border-red-200 bg-red-50 text-red-900";
  }
  if (type === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  return "border-slate-200 bg-white text-slate-800";
}

export function PublicBookingNotificationsProvider({
  children,
  locale = "it",
}) {
  const copy = bookingContent(locale);
  const [notification, setNotification] = useState(null);
  const timeoutRef = useRef(null);
  const notificationIdRef = useRef(0);

  const clearNotificationTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearNotificationTimer, [clearNotificationTimer]);

  const showNotification = useCallback(
    (type, message, options = {}) => {
      clearNotificationTimer();
      notificationIdRef.current += 1;
      const id = notificationIdRef.current;
      setNotification({ id, message: String(message), type });

      const duration = options.duration ?? DEFAULT_DURATION_MS;
      if (duration > 0) {
        timeoutRef.current = window.setTimeout(() => {
          setNotification((current) => (current?.id === id ? null : current));
          timeoutRef.current = null;
        }, duration);
      }
      return id;
    },
    [clearNotificationTimer],
  );

  const showError = useCallback(
    (message, options) => showNotification("error", message, options),
    [showNotification],
  );
  const showSuccess = useCallback(
    (message, options) => showNotification("success", message, options),
    [showNotification],
  );

  const notifyAsync = useCallback(
    async (operation, messages = {}) => {
      const loadingMessage =
        messages.loading ??
        (locale === "en" ? "Working…" : "Operazione in corso…");
      showNotification("loading", loadingMessage, { duration: 0 });
      try {
        const result = await operation();
        showSuccess(
          messages.success ??
            (locale === "en" ? "Completed." : "Operazione completata."),
        );
        return result;
      } catch (error) {
        const errorMessage =
          typeof messages.error === "function"
            ? messages.error(error)
            : (messages.error ?? copy.unavailable);
        showError(errorMessage);
        throw error;
      }
    },
    [copy.unavailable, locale, showError, showNotification, showSuccess],
  );

  const value = useMemo(
    () => ({ notifyAsync, showError, showSuccess }),
    [notifyAsync, showError, showSuccess],
  );

  return (
    <PublicBookingNotificationContext.Provider value={value}>
      {children}
      {notification ? (
        <div
          aria-atomic="true"
          aria-live={notification.type === "error" ? "assertive" : "polite"}
          className={`fixed right-4 top-24 z-50 max-w-[calc(100vw-2rem)] rounded-md border px-4 py-3 text-sm shadow-lg ${notificationStyles(notification.type)}`}
          role={notification.type === "error" ? "alert" : "status"}
        >
          {notification.message}
        </div>
      ) : null}
    </PublicBookingNotificationContext.Provider>
  );
}

export function usePublicBookingNotifications() {
  const value = useContext(PublicBookingNotificationContext);
  if (!value) {
    throw new Error(
      "usePublicBookingNotifications must be used within PublicBookingNotificationsProvider",
    );
  }
  return value;
}
