import "server-only";

import { randomBytes } from "node:crypto";

import {
  issueNewsletterActionCsrfToken,
  newsletterActionCsrfCookie,
} from "./newsletterActionCsrf.ts";

type Action = "confirm" | "unsubscribe";

const CONTRACT = {
  confirm: {
    path: "/newsletter/confirm",
    apiPath: "/api/newsletter/confirm",
    title: "Conferma la tua iscrizione",
    explanation:
      "Conferma esplicitamente per completare l’iscrizione alla newsletter di Gioia Beauty.",
    button: "Conferma iscrizione",
  },
  unsubscribe: {
    path: "/newsletter/unsubscribe",
    apiPath: "/api/newsletter/unsubscribe",
    title: "Annulla l’iscrizione",
    explanation:
      "Conferma esplicitamente per non ricevere più la newsletter di Gioia Beauty.",
    button: "Annulla iscrizione",
  },
} as const;

const NONCE_PATTERN = /^[A-Za-z0-9+/]{24}$/;

function issueNonce(): string {
  return randomBytes(18).toString("base64");
}

function secureHeaders(nonce: string): Headers {
  return new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
    "Content-Type": "text/html; charset=utf-8",
    "Cross-Origin-Resource-Policy": "same-origin",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
}

function html(action: Action, csrfToken: string, nonce: string): string {
  const contract = CONTRACT[action];
  const script = `(()=>{const fragment=location.hash;let token=null;if(fragment.startsWith("#token=")&&!fragment.includes("&")){try{const candidate=decodeURIComponent(fragment.slice(7));if(candidate.length>=1&&candidate.length<=512)token=candidate}catch{token=null}}history.replaceState(null,"",location.pathname);addEventListener("DOMContentLoaded",()=>{const button=document.getElementById("action");const status=document.getElementById("status");if(!button||!status)return;if(!token){button.disabled=true;status.textContent="Il link non è valido o è scaduto.";return}const idempotencyKey=crypto.randomUUID();button.addEventListener("click",async()=>{button.disabled=true;status.textContent="Elaborazione in corso…";try{const response=await fetch(${JSON.stringify(contract.apiPath)},{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","Idempotency-Key":idempotencyKey,"X-CSRF-Token":${JSON.stringify(csrfToken)}},body:JSON.stringify({token})});status.textContent=response.status===202?"Richiesta ricevuta.":"Non è stato possibile completare la richiesta. Riprova."}catch{status.textContent="Non è stato possibile completare la richiesta. Riprova.";button.disabled=false}})})})();`;
  return [
    "<!doctype html>",
    '<html lang="it"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${contract.title} – Gioia Beauty</title>`,
    `<script nonce="${nonce}">${script}</script>`,
    `<style nonce="${nonce}">body{margin:0;background:#faf7f4;color:#211d1a;font-family:Arial,sans-serif}main{max-width:34rem;margin:12vh auto;padding:2rem;text-align:center}button{border:0;background:#211d1a;color:#fff;padding:.8rem 1.2rem;font:inherit;cursor:pointer}button:disabled{opacity:.6;cursor:default}p{line-height:1.5}</style>`,
    "</head><body><main>",
    `<h1>${contract.title}</h1>`,
    `<p>${contract.explanation}</p>`,
    `<button id="action" type="button">${contract.button}</button>`,
    '<p id="status" role="status" aria-live="polite"></p>',
    "</main></body></html>",
  ].join("");
}

export function createNewsletterActionLandingGetHandler({
  action,
  createCsrfToken = issueNewsletterActionCsrfToken,
  createNonce = issueNonce,
  secureCookie = true,
}: {
  readonly action: Action;
  readonly createCsrfToken?: () => string;
  readonly createNonce?: () => string;
  readonly secureCookie?: boolean;
}) {
  const contract = CONTRACT[action];
  if (!contract) throw new TypeError("Invalid newsletter action");

  return function GET(request: Request): Response {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (
      request.method !== "GET" ||
      request.body !== null ||
      url.pathname !== contract.path ||
      url.search !== "" ||
      url.hash !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return new Response(null, { status: 400 });
    }

    try {
      const csrfToken = createCsrfToken();
      const nonce = createNonce();
      if (!NONCE_PATTERN.test(nonce)) throw new TypeError("Invalid nonce");
      const headers = secureHeaders(nonce);
      headers.set(
        "Set-Cookie",
        newsletterActionCsrfCookie(csrfToken, secureCookie),
      );
      return new Response(html(action, csrfToken, nonce), {
        status: 200,
        headers,
      });
    } catch {
      return new Response(null, { status: 503 });
    }
  };
}
