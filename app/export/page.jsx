"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Database, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  downloadOwnerScheduleCsv,
  getOwnerSession,
  OwnerApiError,
  ownerErrorMessage,
} from "@/lib/client/ownerApi.ts";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MAX_EXPORT_DAYS = 366;

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthRange() {
  const now = new Date();
  return {
    fromDate: formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    toDate: formatLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function utcDateOrdinal(value) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function isUnauthorized(error) {
  return (
    error instanceof OwnerApiError &&
    (error.status === 401 || error.status === 403)
  );
}

export default function ScheduleExport() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState(null);
  const [exportStats, setExportStats] = useState(null);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [{ fromDate: initialFromDate, toDate: initialToDate }] = useState(() =>
    currentMonthRange(),
  );
  const [fromDate, setFromDate] = useState(initialFromDate);
  const [toDate, setToDate] = useState(initialToDate);

  useEffect(() => {
    let active = true;

    async function verifyOwnerSession() {
      try {
        await getOwnerSession();
        if (!active) return;
        setIsAuthenticated(true);
      } catch (error) {
        if (!active) return;
        if (isUnauthorized(error)) {
          router.replace("/login");
          return;
        }
        setExportStatus({ type: "error", message: ownerErrorMessage(error) });
      } finally {
        if (active) setAuthLoading(false);
      }
    }

    void verifyOwnerSession();

    return () => {
      active = false;
    };
  }, [router]);

  async function handleExport(event) {
    event.preventDefault();
    setExportStatus(null);
    setExportStats(null);

    if (!fromDate || !toDate) {
      setExportStatus({
        type: "error",
        message: "Seleziona una data iniziale e una data finale.",
      });
      return;
    }

    const daySpan =
      Math.round(
        (utcDateOrdinal(toDate) - utcDateOrdinal(fromDate)) / DAY_IN_MS,
      ) + 1;

    if (daySpan < 1) {
      setExportStatus({
        type: "error",
        message:
          "La data finale deve essere uguale o successiva a quella iniziale.",
      });
      return;
    }

    if (daySpan > MAX_EXPORT_DAYS) {
      setExportStatus({
        type: "error",
        message: "L’intervallo massimo consentito è di 366 giorni.",
      });
      return;
    }

    setIsExporting(true);

    try {
      const { blob, rowCount } = await downloadOwnerScheduleCsv({
        fromDate,
        toDate,
        includeNotes,
      });
      const filename = `gioia-beauty-schedule-${fromDate}_to_${toDate}.csv`;
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);

      setExportStats({ filename, fromDate, rowCount, toDate });
      setExportStatus({
        type: "success",
        message: "Esportazione completata e scaricata.",
      });
    } catch (error) {
      if (isUnauthorized(error)) {
        setIsAuthenticated(false);
        router.replace("/login");
        return;
      }
      setExportStatus({ type: "error", message: ownerErrorMessage(error) });
    } finally {
      setIsExporting(false);
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600 dark:text-gray-300">
            Verifica autenticazione...
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        <div className="text-center">
          {exportStatus ? (
            <p className="text-red-700 dark:text-red-300" role="alert">
              {exportStatus.message}
            </p>
          ) : (
            <p className="text-gray-600 dark:text-gray-300">
              Reindirizzamento al login...
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pt-20 pb-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="mb-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="inline-flex items-center space-x-2 px-4 py-2 border-2 border-blue-500 rounded-md text-sm font-medium text-blue-600 bg-white hover:bg-blue-50 transition-colors shadow-sm"
              type="button"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Torna alla dashboard</span>
            </button>
          </div>

          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Esportazione agenda
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-300">
            Esporta appuntamenti e blocchi in formato CSV per un intervallo
            definito.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
          <div className="flex items-start space-x-6">
            <div className="flex-shrink-0">
              <Database className="w-12 h-12 text-blue-600 dark:text-blue-400" />
            </div>

            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">
                Esporta l’agenda Gioia Beauty
              </h2>

              <p className="text-gray-600 dark:text-gray-300 mb-6">
                Scegli un intervallo massimo di 366 giorni. Ogni esportazione è
                limitata a 500 righe; se il risultato è più grande, restringi le
                date.
              </p>

              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
                <div className="flex items-start space-x-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-yellow-800 dark:text-yellow-300 mb-1">
                      Dati personali
                    </p>
                    <p className="text-yellow-700 dark:text-yellow-400">
                      Il file può contenere dati dei clienti e dettagli degli
                      appuntamenti. Conservalo in modo sicuro e condividilo solo
                      quando necessario.
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleExport}>
                <div className="grid gap-4 sm:grid-cols-2 mb-5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Data iniziale
                    <input
                      className="mt-2 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                      max={toDate || undefined}
                      onChange={(event) => setFromDate(event.target.value)}
                      required
                      type="date"
                      value={fromDate}
                    />
                  </label>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Data finale
                    <input
                      className="mt-2 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                      min={fromDate || undefined}
                      onChange={(event) => setToDate(event.target.value)}
                      required
                      type="date"
                      value={toDate}
                    />
                  </label>
                </div>

                <label className="mb-6 flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    checked={includeNotes}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    onChange={(event) => setIncludeNotes(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    Includi le note degli appuntamenti nel file esportato
                  </span>
                </label>

                <div className="mb-6">
                  <Button
                    disabled={isExporting}
                    size="lg"
                    className="w-full sm:w-auto"
                    type="submit"
                  >
                    {isExporting ? (
                      <>
                        <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-3" />
                        Esportazione in corso...
                      </>
                    ) : (
                      <>
                        <Download className="w-5 h-5 mr-3" />
                        Esporta agenda in CSV
                      </>
                    )}
                  </Button>
                </div>
              </form>

              {exportStatus ? (
                <div
                  className={`mb-6 p-4 rounded-lg ${
                    exportStatus.type === "success"
                      ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300"
                      : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300"
                  }`}
                  role={exportStatus.type === "error" ? "alert" : "status"}
                >
                  <p className="font-medium">{exportStatus.message}</p>
                </div>
              ) : null}

              {exportStats ? (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
                  <h3 className="font-medium text-blue-800 dark:text-blue-300 mb-2">
                    Riepilogo esportazione
                  </h3>
                  <div className="text-sm text-blue-700 dark:text-blue-400 space-y-1 break-words">
                    <p>
                      <strong>Righe:</strong> {exportStats.rowCount}
                    </p>
                    <p>
                      <strong>Intervallo:</strong> {exportStats.fromDate} –{" "}
                      {exportStats.toDate}
                    </p>
                    <p>
                      <strong>File:</strong> {exportStats.filename}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="text-sm text-gray-500 dark:text-gray-400">
                <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Il file include:
                </h3>
                <ul className="list-disc list-inside space-y-1">
                  <li>Appuntamenti nell’intervallo selezionato</li>
                  <li>Blocchi agenda nell’intervallo selezionato</li>
                  <li>Note solo se abilitate esplicitamente</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          Sessione proprietario verificata
        </div>
      </div>
    </div>
  );
}
