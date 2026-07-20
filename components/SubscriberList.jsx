"use client";
import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "react-toastify";
import { Copy, Trash2 } from "lucide-react";
import {
  getOwnerSubscribers,
  ownerErrorMessage,
  runOwnerCommand,
} from "@/lib/client/ownerApi.ts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNotification } from "@/context/NotificationContext";

const SubscriberList = ({ onClose }) => {
  const [subscribers, setSubscribers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);
  const [sortBy, setSortBy] = useState("newest");
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const sortLabels = {
    newest: "Più recenti",
    oldest: "Più vecchi",
    email_asc: "Email A-Z",
    email_desc: "Email Z-A",
  };

  const { showConfirmation, notifyAsync } = useNotification();

  const sortedSubscribers = useMemo(() => {
    const getTime = (subscriber) => {
      const date = subscriber.subscribedAt || subscriber.createdAt;
      const parsedTime = date ? new Date(date).getTime() : 0;
      return Number.isNaN(parsedTime) ? 0 : parsedTime;
    };

    const list = [...subscribers];

    switch (sortBy) {
      case "oldest":
        return list.sort((a, b) => getTime(a) - getTime(b));
      case "email_asc":
        return list.sort((a, b) =>
          (a.email || "").localeCompare(b.email || "", "it", {
            sensitivity: "base",
          }),
        );
      case "email_desc":
        return list.sort((a, b) =>
          (b.email || "").localeCompare(a.email || "", "it", {
            sensitivity: "base",
          }),
        );
      case "newest":
      default:
        return list.sort((a, b) => getTime(b) - getTime(a));
    }
  }, [sortBy, subscribers]);

  const selectedCount = selectedIds.length;
  const allSelected =
    sortedSubscribers.length > 0 && selectedCount === sortedSubscribers.length;
  const hasSelection = selectedCount > 0;

  useEffect(() => {
    const fetchSubscribers = async () => {
      try {
        const result = await getOwnerSubscribers({
          statuses: ["legacy_unverified", "pending", "active", "bounced"],
        });
        setSubscribers(result.items);
        setNextCursor(result.nextCursor);
      } catch (error) {
        toast.error(ownerErrorMessage(error));
      } finally {
        setLoading(false);
      }
    };

    void fetchSubscribers();
  }, []);

  const loadMoreSubscribers = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const result = await getOwnerSubscribers({
        statuses: ["legacy_unverified", "pending", "active", "bounced"],
        cursor: nextCursor,
      });
      setSubscribers((current) => [...current, ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (error) {
      toast.error(ownerErrorMessage(error));
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 max-h-[60vh] overflow-y-auto">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Caricamento iscritti...</p>
        </div>
      </div>
    );
  }

  const copyAllEmails = () => {
    const allEmails = subscribers
      .map((subscriber) => subscriber.email)
      .join(", ");
    navigator.clipboard.writeText(allEmails);
    toast.success("Tutte le email copiate negli appunti!");
  };

  const copyEmail = (email) => {
    navigator.clipboard.writeText(email);
    toast.success("Email copiata!");
  };

  const copySelectedEmails = () => {
    if (!hasSelection) {
      return;
    }

    const selectedEmails = sortedSubscribers
      .filter((subscriber) => selectedIds.includes(subscriber.id))
      .map((subscriber) => subscriber.email)
      .join(", ");

    navigator.clipboard.writeText(selectedEmails);
    toast.success(`${selectedCount} email copiate negli appunti!`);
  };

  const toggleSelect = (subscriberId) => {
    setSelectedIds((prev) =>
      prev.includes(subscriberId)
        ? prev.filter((id) => id !== subscriberId)
        : [...prev, subscriberId],
    );
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
      return;
    }

    setSelectedIds(sortedSubscribers.map((subscriber) => subscriber.id));
  };

  const formatSubscriberDate = (subscriber) => {
    const rawDate = subscriber.subscribedAt || subscriber.createdAt;
    if (!rawDate) {
      return "-";
    }

    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) {
      return "-";
    }

    return parsed.toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleDeleteSubscriber = async (subscriber) => {
    const confirmed = await showConfirmation({
      title: "Disiscrivi contatto",
      message:
        "Vuoi disiscrivere questo contatto? La modifica resterà nello storico e impedirà nuovi invii.",
      confirmText: "Disiscrivi",
      cancelText: "Annulla",
      type: "error",
      allowClose: false,
    });

    if (confirmed !== "confirm") {
      return;
    }

    try {
      await notifyAsync(
        () =>
          runOwnerCommand("/api/admin/subscribers/unsubscribe", {
            subscriberId: subscriber.id,
            expectedVersion: subscriber.version,
          }),
        {
          loading: "Disiscrizione in corso...",
          success: "Contatto disiscritto correttamente",
          error: ownerErrorMessage,
        },
      );

      setSubscribers((prev) => prev.filter((s) => s.id !== subscriber.id));
      setSelectedIds((prev) => prev.filter((id) => id !== subscriber.id));
    } catch (error) {
      toast.error(ownerErrorMessage(error));
    }
  };

  const handleBulkDeleteSubscribers = async () => {
    if (!hasSelection) {
      return;
    }
    if (selectedCount > 20) {
      toast.error("Seleziona al massimo 20 contatti per operazione.");
      return;
    }

    const confirmed = await showConfirmation({
      title: "Disiscrizione multipla",
      message: `Stai per disiscrivere ${selectedCount} contatti. Le modifiche resteranno nello storico.`,
      confirmText: `Disiscrivi ${selectedCount}`,
      cancelText: "Annulla",
      type: "error",
      allowClose: false,
    });

    if (confirmed !== "confirm") {
      return;
    }

    setIsBulkDeleting(true);
    const completedIds = [];
    try {
      await notifyAsync(
        async () => {
          const selected = subscribers.filter((subscriber) =>
            selectedIds.includes(subscriber.id),
          );
          for (const subscriber of selected) {
            await runOwnerCommand("/api/admin/subscribers/unsubscribe", {
              subscriberId: subscriber.id,
              expectedVersion: subscriber.version,
            });
            completedIds.push(subscriber.id);
          }
        },
        {
          loading: "Disiscrizione contatti selezionati...",
          success: `${selectedCount} contatti disiscritti`,
          error: ownerErrorMessage,
        },
      );

      const selectedSet = new Set(selectedIds);
      setSubscribers((prev) =>
        prev.filter((subscriber) => !selectedSet.has(subscriber.id)),
      );
      setSelectedIds([]);
    } catch (error) {
      if (completedIds.length > 0) {
        const completedSet = new Set(completedIds);
        setSubscribers((prev) =>
          prev.filter((subscriber) => !completedSet.has(subscriber.id)),
        );
        setSelectedIds((prev) =>
          prev.filter((subscriberId) => !completedSet.has(subscriberId)),
        );
      }
      toast.error(ownerErrorMessage(error));
    } finally {
      setIsBulkDeleting(false);
    }
  };

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto">
      <div className="mt-8 mb-2 grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/60">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-gray-500 dark:text-zinc-300">
            {subscribers.length} iscritt{subscribers.length !== 1 ? "i" : "o"}
            {hasSelection ? ` • ${selectedCount} selezionati` : ""}
          </span>

          <div className="flex items-center gap-2">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="h-9 w-[170px] text-xs">
                <SelectValue placeholder="Ordina per" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Più recenti</SelectItem>
                <SelectItem value="oldest">Più vecchi</SelectItem>
                <SelectItem value="email_asc">Email A-Z</SelectItem>
                <SelectItem value="email_desc">Email Z-A</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={copyAllEmails}
            size="sm"
            variant="secondary"
            disabled={subscribers.length === 0}
          >
            Copia email caricate
          </Button>
          <Button
            onClick={copySelectedEmails}
            size="sm"
            variant="outline"
            disabled={!hasSelection}
          >
            Copia selezionate
          </Button>
          <Button
            onClick={handleBulkDeleteSubscribers}
            size="sm"
            variant="destructive"
            disabled={!hasSelection || isBulkDeleting}
            className="flex items-center gap-2"
          >
            <Trash2 size={14} />
            {isBulkDeleting ? "Disiscrizione..." : "Disiscrivi selezionati"}
          </Button>
        </div>
      </div>

      <div className="rounded-md bg-gray-100 p-4 dark:bg-zinc-800">
        {subscribers.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 dark:text-gray-400">
              Nessun iscritto newsletter trovato.
            </p>
          </div>
        ) : (
          <ul className="list-none space-y-1">
            <li className="mb-2 flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 accent-zinc-900 dark:accent-zinc-200"
                />
                Seleziona tutti
              </label>
              <span>Ordinamento: {sortLabels[sortBy] || "Personalizzato"}</span>
            </li>

            {sortedSubscribers.map((subscriber) => (
              <li
                key={subscriber.id}
                className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <div className="min-w-0 flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(subscriber.id)}
                    onChange={() => toggleSelect(subscriber.id)}
                    className="h-4 w-4 accent-zinc-900 dark:accent-zinc-200"
                    aria-label={`Seleziona ${subscriber.email}`}
                  />

                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-800 dark:text-zinc-100">
                      {subscriber.email}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Iscritto: {formatSubscriberDate(subscriber)}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Stato: {subscriber.status}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => copyEmail(subscriber.email)}
                    className="rounded p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    aria-label="Copia questa email"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    onClick={() => handleDeleteSubscriber(subscriber)}
                    className="rounded-full p-2 hover:bg-red-100 dark:hover:bg-red-900"
                    aria-label="Disiscrivi"
                  >
                    <Trash2 size={16} className="text-red-500" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {nextCursor ? (
        <Button
          className="w-full"
          disabled={isLoadingMore}
          onClick={loadMoreSubscribers}
          type="button"
          variant="outline"
        >
          {isLoadingMore ? "Caricamento..." : "Carica altri iscritti"}
        </Button>
      ) : null}
    </div>
  );
};

export default SubscriberList;
