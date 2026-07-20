"use client";
import React, { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "react-toastify";
import {
  newIdempotencyKey,
  publicErrorMessage,
  shouldRetainPublicIdempotencyKey,
  subscribeToNewsletter,
} from "@/lib/client/publicApi.ts";

const NewsletterSignup = () => {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const subscriptionAttemptRef = useRef(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
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
      );
      subscriptionAttemptRef.current = null;
      toast.success("Controlla la tua email per confermare l’iscrizione.");
      setEmail("");
    } catch (error) {
      if (!shouldRetainPublicIdempotencyKey(error)) {
        subscriptionAttemptRef.current = null;
      }
      toast.error(publicErrorMessage(error));
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
            required
            className="bg-primary !placeholder-white text-white"
          />
          <Button
            className="text-primary inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:shadow disabled:pointer-events-none disabled:opacity-50 bg-white hover:bg-gray-100 h-10 px-4 py-2 mt-3"
            type="submit"
            disabled={submitting}
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
