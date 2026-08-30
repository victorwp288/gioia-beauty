import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Bricolage_Grotesque, DM_Serif_Display } from "next/font/google";
import Footer from "@/components/layout/Footer";
import Navbar from "@/components/layout/Navbar";
import { buildBusinessStructuredData } from "@/lib/content/businessStructuredData";

const bricolage = Bricolage_Grotesque({
  style: "normal",
  display: "swap",
  subsets: ["latin"],
  variable: "--bricolage",
});

const dmSerif = DM_Serif_Display({
  weight: "400",
  style: "normal",
  display: "swap",
  subsets: ["latin"],
  variable: "--serif",
});

export default function PublicDocument({ children, locale = "it" }) {
  const skipLabel =
    locale === "en" ? "Skip to main content" : "Vai al contenuto principale";
  const hasVercelTelemetry = process.env.VERCEL === "1";

  return (
    <html
      lang={locale}
      data-scroll-behavior="smooth"
      className={`${bricolage.variable} ${dmSerif.variable} h-full scroll-smooth font-bricolage antialiased`}
    >
      <body className="flex h-full flex-col bg-white">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(buildBusinessStructuredData(locale)),
          }}
        />
        <a
          href="#main-content"
          className="sr-only fixed left-4 top-4 z-100 bg-white px-4 py-3 font-semibold text-[#3f3a37] shadow-lg focus:not-sr-only focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          {skipLabel}
        </a>
        <div className="flex min-h-screen flex-col">
          <Navbar locale={locale} />
          <div id="main-content" className="flex-1" tabIndex={-1}>
            {children}
          </div>
          <Footer locale={locale} />
        </div>
        {hasVercelTelemetry ? (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        ) : null}
      </body>
    </html>
  );
}
