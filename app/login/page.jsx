"use client";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/Fields";
import { SlimLayout } from "@/components/SlimLayout";
import {
  loginOwner,
  OwnerApiError,
  ownerErrorMessage,
} from "@/lib/client/ownerApi.ts";
import logo from "@/images/logo.png";
import Image from "next/image";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  async function handleAuth(event) {
    event.preventDefault();
    if (isSubmitting) return;

    setAuthError("");
    setIsSubmitting(true);

    try {
      await loginOwner(email.trim(), password);
      setEmail("");
      setPassword("");
      router.replace("/dashboard");
    } catch (error) {
      if (error instanceof OwnerApiError) {
        if (error.code === "INVALID_CREDENTIALS") {
          setAuthError("Email o password non corretti.");
        } else if (error.code === "RATE_LIMITED") {
          setAuthError("Troppi tentativi. Attendi un minuto e riprova.");
        } else {
          setAuthError(ownerErrorMessage(error));
        }
      } else {
        setAuthError(ownerErrorMessage(error));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SlimLayout>
      <div className="flex">
        <Link href="/" aria-label="Home">
          <Image
            alt="logo"
            width={150}
            src={logo}
            style={{
              maxWidth: "100%",
              height: "auto",
            }}
          />
        </Link>
      </div>
      <h2 className="mt-20 text-lg font-semibold text-gray-900">
        Accedi al tuo account
      </h2>
      <form
        action="/api/auth/login"
        method="post"
        onSubmit={handleAuth}
        data-hydrated={isHydrated ? "true" : "false"}
        className="mt-10 grid grid-cols-1 gap-y-8 w-full max-w-sm mx-auto"
      >
        <TextField
          label="Indirizzo email"
          name="email"
          type="email"
          value={email}
          autoComplete="email"
          required
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          value={password}
          autoComplete="current-password"
          required
          onChange={(e) => setPassword(e.target.value)}
        />
        {authError ? (
          <p className="text-sm text-red-600" role="alert">
            {authError}
          </p>
        ) : null}
        <div className="w-full">
          <Button
            type="submit"
            variant="solid"
            color="blue"
            className="w-full"
            disabled={isSubmitting}
          >
            <span>
              {isSubmitting ? "Accesso in corso..." : "Accedi"}{" "}
              {!isSubmitting ? <span aria-hidden="true">&rarr;</span> : null}
            </span>
          </Button>
        </div>
      </form>
    </SlimLayout>
  );
}
