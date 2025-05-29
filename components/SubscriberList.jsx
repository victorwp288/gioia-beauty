"use client";
import React, { useEffect, useState } from "react";
import { SubscriberService } from "@/lib/firebase/subscribers";
import { Button } from "@/components/ui/button";
import { toast } from "react-toastify";
import { Copy, X as LucideX } from "lucide-react";

const SubscriberList = ({ onClose }) => {
  const [subscribers, setSubscribers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSubscribers = async () => {
      console.log("🔍 SubscriberList: Starting to fetch active subscribers...");
      try {
        const subscriberService = new SubscriberService();

        // Only fetch active subscribers to reduce data
        const subscriberData = await subscriberService.getSubscribers({
          status: "active",
          limitCount: 100, // Reasonable limit
        });

        console.log(
          "✅ SubscriberList: Fetched active subscribers:",
          subscriberData.length
        );

        setSubscribers(subscriberData);
      } catch (error) {
        console.error("❌ SubscriberList: Error fetching:", error);
        toast.error("Failed to load subscribers");
      } finally {
        setLoading(false);
      }
    };

    fetchSubscribers();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 max-h-[60vh] overflow-y-auto">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading subscribers...</p>
        </div>
      </div>
    );
  }

  const copyAllEmails = () => {
    const allEmails = subscribers
      .map((subscriber) => subscriber.email)
      .join(", ");
    navigator.clipboard.writeText(allEmails);
    toast.success("All emails copied to clipboard!");
  };

  const copyEmail = (email) => {
    navigator.clipboard.writeText(email);
    toast.success("Email copiata!");
  };

  const handleDeleteSubscriber = async (subscriberId) => {
    try {
      const subscriberService = new SubscriberService();
      await subscriberService.deleteSubscriber(subscriberId);
      setSubscribers(subscribers.filter((s) => s.id !== subscriberId));
      toast.success("Subscriber deleted successfully");
    } catch (error) {
      console.error("Error deleting subscriber:", error);
      toast.error("Failed to delete subscriber. Please try again.");
    }
  };

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto">
      <div className="flex items-center justify-between mt-8 mb-2 gap-2">
        <Button onClick={copyAllEmails} size="sm" variant="secondary">
          Copia tutte le email
        </Button>
      </div>
      <div className="bg-gray-100 dark:bg-zinc-800 p-4 rounded-md">
        <ul className="list-none">
          {subscribers.map((subscriber) => (
            <li
              key={subscriber.id}
              className="flex items-center justify-between py-2 border-b border-gray-200 dark:border-zinc-700"
            >
              <span className="flex items-center gap-2">
                {subscriber.email}
                <button
                  onClick={() => copyEmail(subscriber.email)}
                  className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  aria-label="Copia questa email"
                >
                  <Copy size={16} />
                </button>
              </span>
              <button
                onClick={() => handleDeleteSubscriber(subscriber.id)}
                className="p-2 hover:bg-red-100 dark:hover:bg-red-900 rounded-full"
                aria-label="Elimina"
              >
                <LucideX size={16} className="text-red-500" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default SubscriberList;
