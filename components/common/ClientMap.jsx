"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const Map = dynamic(() => import("./Map"), { ssr: false });

export default function ClientMap({ locale = "it", ...props }) {
  const [visible, setVisible] = useState(false);

  if (!visible) {
    return (
      <div className="mt-8 flex min-h-56 items-center justify-center rounded-2xl bg-[#f4efec] p-6 text-center">
        <div>
          <p className="text-sm text-slate-600">
            {locale === "en"
              ? "Load the interactive map to see the salon location."
              : "Carica la mappa interattiva per vedere la posizione del centro."}
          </p>
          <button
            type="button"
            onClick={() => setVisible(true)}
            className="mt-4 rounded-sm bg-primary px-5 py-3 font-semibold text-white"
          >
            {locale === "en" ? "Show map" : "Mostra la mappa"}
          </button>
        </div>
      </div>
    );
  }

  return <Map {...props} locale={locale} />;
}
