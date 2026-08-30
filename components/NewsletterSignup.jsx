"use client";
import React, { useCallback, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import TurnstileChallenge from "@/components/common/TurnstileChallenge";
import { usePublicBookingNotifications } from "@/components/booking/PublicBookingNotifications";
import {
  ClientApiError,
  newIdempotencyKey,
  publicErrorMessage,
  shouldRetainPublicIdempotencyKey,
  subscribeToNewsletter,
} from "@/lib/client/publicApi.ts";

const NewsletterSignup = () => {
  const { showError, showSuccess } = usePublicBookingNotifications();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [humanChallengeRequired, setHumanChallengeRequired] = useState(false);
  const [humanChallengeToken, setHumanChallengeToken] = useState(null);
  const [humanChallengeReset, setHumanChallengeReset] = useState(0);
  const [humanChallengeUnavailable, setHumanChallengeUnavailable] =
    useState(false);
  const subscriptionAttemptRef = useRef(null);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const handleHumanChallengeToken = useCallback((token) => {
    setHumanChallengeToken(token);
    if (token) setHumanChallengeUnavailable(false);
  }, []);
  const handleHumanChallengeUnavailable = useCallback(() => {
    setHumanChallengeToken(null);
    setHumanChallengeUnavailable(true);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (humanChallengeRequired && !humanChallengeToken) {
      showError("Completa la verifica di sicurezza e riprova.");
      return;
    }
    setSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (subscriptionAttemptRef.current?.email !== normalizedEmail) {
        subscriptionAttemptRef.current = {
          email: normalizedEmail,
          idempotencyKey: newIdempotencyKey(),
        };
      }
      await subscribeToNewsletter(
        normalizedEmail,
        subscriptionAttemptRef.current.idempotencyKey,
        humanChallengeToken || undefined,
      );
      subscriptionAttemptRef.current = null;
      setHumanChallengeRequired(false);
      setHumanChallengeToken(null);
      setHumanChallengeUnavailable(false);
      showSuccess("Controlla la tua email per confermare l’iscrizione.");
      setEmail("");
    } catch (error) {
      if (
        error instanceof ClientApiError &&
        error.code === "HUMAN_VERIFICATION_REQUIRED"
      ) {
        setHumanChallengeRequired(true);
      }
      if (humanChallengeToken) {
        setHumanChallengeToken(null);
        setHumanChallengeReset((value) => value + 1);
      }
      if (!shouldRetainPublicIdempotencyKey(error)) {
        subscriptionAttemptRef.current = null;
      }
      showError(publicErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full bg-primary mt-16 py-12 text-center">
      <div className="max-w-md mx-auto mt-10 md:w-full md:mt-0">
        <div className="text-white px-4 pt-6">
          <h2 className="font-bold text-2xl pb-4">Newsletter</h2>
          <p className="text-sm">
            Per rimanere aggiornato sulle offerte e promozioni, puoi iscriverti
            alla newsletter mensile che, ogni primo giorno del mese, arriverà
            nella tua casella di posta.
          </p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-2 container mt-12"
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Inserisci la tua mail"
            aria-label="Email per la newsletter"
            autoComplete="email"
            required
            className="bg-primary placeholder-white! text-white"
          />
          {humanChallengeRequired ? (
            <div className="space-y-2">
              <p
                id="newsletter-security-verification"
                className="text-sm text-white"
                role="status"
              >
                Completa la verifica di sicurezza per continuare.
              </p>
              {humanChallengeUnavailable ? (
                <p className="text-sm text-white" role="alert">
                  La verifica non è disponibile. Ricarica la pagina e riprova.
                </p>
              ) : null}
              <TurnstileChallenge
                action="public_newsletter_subscribe"
                onToken={handleHumanChallengeToken}
                onUnavailable={handleHumanChallengeUnavailable}
                resetSignal={humanChallengeReset}
                siteKey={turnstileSiteKey}
              />
            </div>
          ) : null}
          <Button
            className="text-primary inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:shadow-sm disabled:pointer-events-none disabled:opacity-50 bg-white hover:bg-gray-100 h-10 px-4 py-2 mt-3"
            type="submit"
            aria-describedby={
              humanChallengeRequired
                ? "newsletter-security-verification"
                : undefined
            }
            disabled={
              submitting || (humanChallengeRequired && !humanChallengeToken)
            }
          >
            {submitting
              ? "Iscrizione in corso..."
              : "Iscriviti alla newsletter"}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default NewsletterSignup;
