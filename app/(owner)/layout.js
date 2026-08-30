import "../globals.css";
import { Bricolage_Grotesque } from "next/font/google";

export const metadata = {
  title: {
    default: "Area riservata - Gioia Beauty",
    template: "%s - Gioia Beauty",
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export const viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
};

const bricolage = Bricolage_Grotesque({
  style: "normal",
  display: "swap",
  subsets: ["latin"],
  variable: "--bricolage",
});

export default function OwnerLayout({ children }) {
  return (
    <html
      lang="it"
      className={`${bricolage.variable} font-bricolage h-full antialiased`}
    >
      <body className="flex h-full flex-col bg-white">{children}</body>
    </html>
  );
}
