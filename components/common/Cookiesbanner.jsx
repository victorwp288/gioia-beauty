"use client";
import { useState, useEffect } from "react";

export function Cookiesbanner({ locale = "it" }) {
  const [firstVisit, setFirstVisit] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("firstVisit")) {
      setFirstVisit(true);
    }
  }, []);

  const handleAcceptCookies = () => {
    localStorage.setItem("firstVisit", "accepted");
    setFirstVisit(false);
  };

  if (!firstVisit) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label={
        locale === "en" ? "Cookie information" : "Informazioni sui cookie"
      }
      className="fixed bottom-0 left-0 right-0 bg-gray-900 py-4 px-6 text-white md:py-6 md:px-8"
      style={{ zIndex: 9999 }}
    >
      <div className="container mx-auto flex flex-col items-center justify-between gap-4 md:flex-row">
        <div className="space-y-2">
          <p className="text-lg font-semibold">
            {locale === "en" ? "Cookie information" : "Informazioni sui cookie"}
          </p>
          <p className="text-sm text-gray-200">
            {locale === "en"
              ? "We use essential browser storage to remember your preferences and keep the site working correctly."
              : "Utilizziamo solo l’archiviazione essenziale del browser per ricordare le tue preferenze e far funzionare correttamente il sito."}
          </p>
        </div>
        <div className="flex flex-col items-center gap-2 sm:flex-row">
          <button
            type="button"
            className="min-h-11 w-full rounded-md bg-white px-4 py-2 font-medium text-gray-950 hover:bg-gray-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 sm:w-auto"
            onClick={handleAcceptCookies}
          >
            {locale === "en" ? "Understood" : "Ho capito"}
          </button>
        </div>
      </div>
    </div>
  );
}
