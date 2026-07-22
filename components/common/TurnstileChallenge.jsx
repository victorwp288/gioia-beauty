"use client";

import Script from "next/script";
import { useCallback, useEffect, useId, useRef } from "react";

const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_ACTIONS = new Set([
  "public_booking",
  "public_newsletter_subscribe",
]);

export default function TurnstileChallenge({
  action,
  onUnavailable,
  onToken,
  resetSignal,
  siteKey,
}) {
  const reactId = useId();
  const containerId = `turnstile-${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const widgetIdRef = useRef(null);
  const onTokenRef = useRef(onToken);
  const onUnavailableRef = useRef(onUnavailable);

  useEffect(() => {
    onTokenRef.current = onToken;
    onUnavailableRef.current = onUnavailable;
  }, [onToken, onUnavailable]);

  const reportUnavailable = useCallback(() => {
    onTokenRef.current(null);
    onUnavailableRef.current?.();
  }, []);

  const renderWidget = useCallback(() => {
    if (
      !siteKey ||
      !TURNSTILE_ACTIONS.has(action) ||
      !window.turnstile ||
      widgetIdRef.current !== null
    ) {
      return;
    }
    try {
      widgetIdRef.current = window.turnstile.render(`#${containerId}`, {
        action,
        appearance: "interaction-only",
        callback: (token) => onTokenRef.current(token),
        "error-callback": reportUnavailable,
        "expired-callback": () => onTokenRef.current(null),
        execution: "render",
        "refresh-expired": "auto",
        retry: "auto",
        sitekey: siteKey,
        size: "flexible",
        theme: "auto",
        "unsupported-callback": reportUnavailable,
      });
    } catch {
      reportUnavailable();
    }
  }, [action, containerId, reportUnavailable, siteKey]);

  useEffect(() => {
    if (!siteKey || !TURNSTILE_ACTIONS.has(action)) reportUnavailable();
  }, [action, reportUnavailable, siteKey]);

  useEffect(() => {
    renderWidget();
    return () => {
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // The provider may already have removed a failed widget.
        }
        widgetIdRef.current = null;
      }
    };
  }, [renderWidget]);

  useEffect(() => {
    if (resetSignal <= 0) return;
    if (widgetIdRef.current !== null && window.turnstile) {
      try {
        onTokenRef.current(null);
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        reportUnavailable();
      }
    }
  }, [reportUnavailable, resetSignal]);

  if (!siteKey || !TURNSTILE_ACTIONS.has(action)) return null;

  return (
    <>
      <Script
        id="gioia-turnstile"
        src={TURNSTILE_SCRIPT}
        strategy="afterInteractive"
        onError={reportUnavailable}
        onReady={renderWidget}
      />
      <div
        id={containerId}
        className="min-h-0 w-full"
        data-testid={`turnstile-${action}`}
        role="group"
        aria-label="Verifica di sicurezza"
      />
    </>
  );
}
